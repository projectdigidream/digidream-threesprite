import * as vscode from 'vscode'
import { TSpriteDocument } from './document'
import type { FromWebview, ToWebview } from './protocol'
import { buildWebviewHtml, makeNonce } from './webviewHtml'

/** How long to wait for the webview to hand back the project bytes. */
const BYTES_TIMEOUT_MS = 20_000

export class TSpriteEditorProvider implements vscode.CustomEditorProvider<TSpriteDocument> {
  static readonly viewType = 'threesprite.editor'

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      TSpriteEditorProvider.viewType,
      new TSpriteEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        // The live project lives in the webview, so one tab owns one document.
        // VS Code reveals the open tab instead of opening a second, divergent copy.
        supportsMultipleEditorsPerDocument: false,
      },
    )
  }

  private readonly panels = new Map<string, vscode.WebviewPanel>()
  private readonly pending = new Map<number, (body: string) => void>()
  private nextRequestId = 1

  private readonly _onDidChangeCustomDocument =
    new vscode.EventEmitter<vscode.CustomDocumentEditEvent<TSpriteDocument>>()
  readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event

  constructor(private readonly context: vscode.ExtensionContext) {}

  // ── document lifecycle ───────────────────────────────────────────────────

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
  ): Promise<TSpriteDocument> {
    return TSpriteDocument.create(uri, openContext.backupId)
  }

  async resolveCustomEditor(document: TSpriteDocument, panel: vscode.WebviewPanel): Promise<void> {
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media')
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] }

    const index = await this.readIndexHtml(media)
    if (index === null) {
      panel.webview.html = missingBuildHtml()
      return
    }
    panel.webview.html = buildWebviewHtml(index, {
      assetRoot: panel.webview.asWebviewUri(media).toString(),
      nonce: makeNonce(),
      cspSource: panel.webview.cspSource,
    })

    const key = document.uri.toString()
    this.panels.set(key, panel)
    panel.onDidDispose(() => { if (this.panels.get(key) === panel) this.panels.delete(key) })

    panel.webview.onDidReceiveMessage((message: FromWebview) => {
      if (!message || typeof message.type !== 'string') return
      switch (message.type) {
        case 'ready':
          this.post(panel, {
            type: 'init',
            body: Buffer.from(document.initialContent).toString('base64'),
            path: document.uri.scheme === 'file' ? document.uri.fsPath : document.uri.toString(),
          })
          break
        case 'edit':
          // The webview keeps the only copy of the project, so undo and redo
          // are forwarded to it rather than replaying anything here.
          this._onDidChangeCustomDocument.fire({
            document,
            label: 'Edit sprite',
            undo: () => this.post(panel, { type: 'undo' }),
            redo: () => this.post(panel, { type: 'redo' }),
          })
          break
        case 'bytes': {
          const resolve = this.pending.get(message.id)
          if (resolve) { this.pending.delete(message.id); resolve(message.body) }
          break
        }
        case 'save':
          void vscode.commands.executeCommand('workbench.action.files.save')
          break
        case 'error':
          void vscode.window.showErrorMessage(`ThreeSprite: ${message.message}`)
          break
      }
    })
  }

  // ── saving ───────────────────────────────────────────────────────────────

  async saveCustomDocument(document: TSpriteDocument, cancellation: vscode.CancellationToken): Promise<void> {
    await this.saveTo(document, document.uri, cancellation)
    const panel = this.panels.get(document.uri.toString())
    if (panel) this.post(panel, { type: 'saved' })
  }

  async saveCustomDocumentAs(
    document: TSpriteDocument,
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken,
  ): Promise<void> {
    await this.saveTo(document, destination, cancellation)
  }

  async revertCustomDocument(document: TSpriteDocument): Promise<void> {
    const panel = this.panels.get(document.uri.toString())
    if (!panel) return
    const bytes = await vscode.workspace.fs.readFile(document.uri)
    document.initialContent = bytes
    this.post(panel, { type: 'revert', body: Buffer.from(bytes).toString('base64') })
  }

  async backupCustomDocument(
    document: TSpriteDocument,
    context: vscode.CustomDocumentBackupContext,
    cancellation: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    await this.saveTo(document, context.destination, cancellation)
    return {
      id: context.destination.toString(),
      delete: async () => {
        try { await vscode.workspace.fs.delete(context.destination) } catch { /* already gone */ }
      },
    }
  }

  private async saveTo(document: TSpriteDocument, target: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
    const body = await this.requestBytes(document, cancellation)
    if (cancellation.isCancellationRequested) return
    await vscode.workspace.fs.writeFile(target, Buffer.from(body, 'base64'))
  }

  /** Ask the webview to encode the live project. */
  private requestBytes(document: TSpriteDocument, cancellation: vscode.CancellationToken): Promise<string> {
    const panel = this.panels.get(document.uri.toString())
    if (!panel) throw new Error('the sprite editor for this file is not open')
    const id = this.nextRequestId++
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('the sprite editor did not respond'))
      }, BYTES_TIMEOUT_MS)
      const done = cancellation.onCancellationRequested(() => {
        clearTimeout(timer)
        this.pending.delete(id)
        done.dispose()
        reject(new Error('cancelled'))
      })
      this.pending.set(id, body => { clearTimeout(timer); done.dispose(); resolve(body) })
      this.post(panel, { type: 'getBytes', id })
    })
  }

  private post(panel: vscode.WebviewPanel, message: ToWebview): void {
    void panel.webview.postMessage(message)
  }

  private async readIndexHtml(media: vscode.Uri): Promise<string | null> {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(media, 'index.html'))
      return Buffer.from(bytes).toString('utf8')
    } catch {
      return null
    }
  }
}

function missingBuildHtml(): string {
  return `<!doctype html><html><body style="font-family: sans-serif; padding: 24px; line-height: 1.5">
    <h2>The editor is not built yet</h2>
    <p>Run <code>pnpm run build</code> in the extension folder to compile the app into <code>media/</code>, then reopen this file.</p>
  </body></html>`
}
