import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider } from 'jotai'
import { loader } from '@monaco-editor/react'
import App from './App'
import './index.css'
import 'katex/dist/katex.min.css'

// Import Monaco editor core API only (not the full bundle)
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'

// Import language tokenizers (syntax highlighting)
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution'
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution'
import 'monaco-editor/esm/vs/basic-languages/scss/scss.contribution'
import 'monaco-editor/esm/vs/basic-languages/less/less.contribution'
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution'
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution'
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution'
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution'
import 'monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution'
import 'monaco-editor/esm/vs/basic-languages/swift/swift.contribution'
import 'monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution'
import 'monaco-editor/esm/vs/basic-languages/php/php.contribution'
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution'
import 'monaco-editor/esm/vs/basic-languages/dart/dart.contribution'
import 'monaco-editor/esm/vs/basic-languages/lua/lua.contribution'
import 'monaco-editor/esm/vs/basic-languages/r/r.contribution'
import 'monaco-editor/esm/vs/basic-languages/scala/scala.contribution'
import 'monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution'

// Import language services (diagnostics, intellisense)
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution'
import 'monaco-editor/esm/vs/language/json/monaco.contribution'
import 'monaco-editor/esm/vs/language/css/monaco.contribution'
import 'monaco-editor/esm/vs/language/html/monaco.contribution'

// Vite worker imports — ?worker suffix tells Vite to bundle as web worker
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

// Configure worker loading for language services
self.MonacoEnvironment = {
  getWorker: async (_, label) => {
    if (label === 'typescript' || label === 'javascript') {
      return new TsWorker()
    }
    if (label === 'json') {
      return new JsonWorker()
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new CssWorker()
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new HtmlWorker()
    }
    return new EditorWorker()
  },
}

// Configure @monaco-editor/react to use the local Monaco instance
loader.config({ monaco })

const root = document.getElementById('root')!

// Defensive: if preload failed, show error instead of white screen
if (!window.electronAPI) {
  root.innerHTML = `
    <div style="padding:40px;font-family:sans-serif;color:#666">
      <h2 style="color:#e11d48">⚠️ Preload failed</h2>
      <p><code>window.electronAPI</code> is not defined.</p>
      <p>This usually means the preload script failed to load.</p>
      <p>Check the terminal for main-process errors.</p>
    </div>
  `
  throw new Error('window.electronAPI is not defined — preload failed')
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <JotaiProvider>
      <App />
    </JotaiProvider>
  </React.StrictMode>
)
