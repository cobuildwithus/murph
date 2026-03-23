export default function RootLayout(input: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{input.children}</body>
    </html>
  );
}
