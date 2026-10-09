import { CollectionPage } from './collection-page';

export default function Page() {
  return (
    <main className="collection-shell">
      <section className="collection-card">
        <p className="eyebrow">Secure credential request</p>
        <h1>Connect your account</h1>
        <p className="intro">Your credentials are sent directly to the application that requested them.</p>
        <CollectionPage />
      </section>
    </main>
  );
}
