"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="fatal-error">
      <h1>A little turbulence.</h1>
      <p>The explorer couldn’t load. Please try again.</p>
      <button onClick={reset}>Reload explorer</button>
    </main>
  );
}
