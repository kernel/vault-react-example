import { CardCapturePage } from './card-capture-page';

export default function Page() {
  return (
    <main className="collection-shell">
      <section className="collection-card">
        <p className="eyebrow">Payment method</p>
        <CardCapturePage />
      </section>
    </main>
  );
}
