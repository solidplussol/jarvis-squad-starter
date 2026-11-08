// SPDX-License-Identifier: AGPL-3.0-only
// Containment boundary: a failure inside an optional panel must never blank the graph app.

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
}

export class PanelBoundary extends Component<{ label: string; children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label} failed to render:`, error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        role="alert"
        style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 300, maxWidth: 420, padding: '6px 12px', background: 'rgba(30,10,10,0.9)', color: '#ff8a8a', border: '1px solid #7a1d1d', borderRadius: 4, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11 }}
      >
        {this.props.label} unavailable: {this.state.error.message}
        <button
          onClick={() => this.setState({ error: null })}
          style={{ marginLeft: 8, background: 'transparent', color: '#7fdcff', border: '1px solid #1d5f7a', borderRadius: 3, cursor: 'pointer', fontSize: 11 }}
        >
          Retry
        </button>
      </div>
    )
  }
}
