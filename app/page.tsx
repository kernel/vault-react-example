export default function Home() {
  return (
    <main className="collection-shell">
      <section className="collection-card">
        <p className="eyebrow">@onkernel/vault-react</p>
        <h1>Customer-hosted credential collection</h1>
        <p className="intro">
          Generate a one-time collection link with <code>bun run create-request</code>, then open the
          printed URL. Add <code>--encrypted</code> for the flow that encrypts values in the browser.
        </p>
      </section>
    </main>
  );
}
