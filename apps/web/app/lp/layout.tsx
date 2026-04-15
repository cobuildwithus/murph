export default function LpLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`#global-footer { display: none; }`}</style>
      {children}
    </>
  );
}
