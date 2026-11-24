import { Component, type ReactNode } from 'react';

export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="welcome" style={{ minHeight: '100dvh' }}><span className="eyebrow">GALEATA</span><h1>Un composant n’a pas pu démarrer.</h1><p>Le plan enregistré reste conservé. Recharger abandonnera les modifications de fichiers non sauvegardées.</p><button className="button" style={{ marginTop: 20 }} onClick={() => window.location.reload()}>Recharger l’application</button></main>;
    return this.props.children;
  }
}
