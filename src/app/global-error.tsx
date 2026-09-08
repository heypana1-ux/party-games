"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          background: "#0a090c",
          color: "#f5f2f7",
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100dvh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ color: "#a69eb0" }}>The app failed to load.</p>
        <button
          onClick={reset}
          style={{
            background: "#9b7bf7",
            color: "#0e0a18",
            border: 0,
            borderRadius: 16,
            padding: "0.9rem 1.5rem",
            fontWeight: 600,
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
