export { metadata } from "./lp/page";

import LandingPage from "./lp/page";

export default async function HomePage() {
  return (
    <>
      <style>{`#global-footer { display: none; }`}</style>
      {await LandingPage()}
    </>
  );
}
