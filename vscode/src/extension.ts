import * as vscode from 'vscode'
import { TSpriteEditorProvider } from './provider'

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(TSpriteEditorProvider.register(context))

  context.subscriptions.push(
    vscode.commands.registerCommand('prspr-editor.newProject', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]
      const target = await vscode.window.showSaveDialog({
        title: 'New sprite project',
        defaultUri: folder ? vscode.Uri.joinPath(folder.uri, 'sprite.tsprite') : undefined,
        filters: { 'PrSpr editor project': ['tsprite'] },
      })
      if (!target) return
      // An empty file. The editor sees no bytes, asks for the canvas size and
      // view count (both fixed once a project exists) and writes the result
      // back straight away, so the placeholder never outlives the setup.
      await vscode.workspace.fs.writeFile(target, new Uint8Array())
      await vscode.commands.executeCommand('vscode.openWith', target, TSpriteEditorProvider.viewType)
    }),
  )
}

export function deactivate(): void {
  /* nothing to tear down: the provider's disposables are owned by the context */
}
