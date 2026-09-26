import Link from "next/link";

export default function Home() {
  return (
    <main className="landing-page">
      <nav className="landing-nav"><strong>SaaS Launchup</strong><Link href="/login">Sign in</Link></nav>
      <section className="landing-hero">
        <p className="landing-kicker">The operating system for your next stage</p>
        <h1>Launch the business behind your SaaS.</h1>
        <p>Keep sales, customer operations, marketing, forms, and bookings in one focused workspace built for your company.</p>
        <div className="landing-actions"><Link className="landing-primary" href="/login?mode=register">Create your workspace</Link><Link className="landing-secondary" href="/login">Sign in</Link></div>
      </section>
      <section className="landing-strip"><span>CRM foundation</span><span>Booking workflows</span><span>Growth planning</span><span>Private by default</span></section>
    </main>
  );
}
