import * as vscode from 'vscode'
import { TSpriteEditorProvider } from './provider'

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(TSpriteEditorProvider.register(context))

  context.subscriptions.push(
    vscode.commands.registerCommand('threesprite.newProject', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]
      const target = await vscode.window.showSaveDialog({
        title: 'New sprite project',
        defaultUri: folder ? vscode.Uri.joinPath(folder.uri, 'sprite.tsprite') : undefined,
        filters: { 'ThreeSprite project': ['tsprite'] },
      })
      if (!target) return
      // An empty file: the editor starts a fresh project and the first save fills it in.
      await vscode.workspace.fs.writeFile(target, new Uint8Array())
      await vscode.commands.executeCommand('vscode.openWith', target, TSpriteEditorProvider.viewType)
    }),
  )
}

export function deactivate(): void {
  /* nothing to tear down: the provider's disposables are owned by the context */
}
