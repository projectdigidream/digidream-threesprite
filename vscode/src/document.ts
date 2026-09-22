import * as vscode from 'vscode'

/**
 * A `.tsprite` open in an editor tab.
 *
 * The bytes on disk are read once when the tab opens and handed to the webview,
 * which owns the live document from then on. The host asks for bytes again when
 * it needs to write (save, save-as, hot-exit backup), so a stroke of the pencil
 * costs a message rather than a re-zip of the whole project.
 */
export class TSpriteDocument implements vscode.CustomDocument {
  private readonly _onDidDispose = new vscode.EventEmitter<void>()
  readonly onDidDispose = this._onDidDispose.event

  private constructor(
    readonly uri: vscode.Uri,
    public initialContent: Uint8Array,
  ) {}

  static async create(uri: vscode.Uri, backupId: string | undefined): Promise<TSpriteDocument> {
    // A backup left by hot exit stands in for the file on disk.
    const source = backupId ? vscode.Uri.parse(backupId) : uri
    const content = uri.scheme === 'untitled' ? new Uint8Array() : await readIfPresent(source)
    return new TSpriteDocument(uri, content)
  }

  dispose(): void {
    this._onDidDispose.fire()
    this._onDidDispose.dispose()
  }
}

/** An empty or missing file is not an error: the editor opens a fresh project. */
async function readIfPresent(uri: vscode.Uri): Promise<Uint8Array> {
  try {
    return await vscode.workspace.fs.readFile(uri)
  } catch {
    return new Uint8Array()
  }
}
