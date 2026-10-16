import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchAuthCapabilities } from "../lib/auth-capabilities";
import { WindowChrome } from "./WindowChrome";

export function WelcomePage() {
  const navigate = useNavigate();
  // Registration is closed on this deployment. Leading with a primary "Sign up" button that
  // cannot succeed is a bad front door for an internal tool, so ask the server and only offer
  // it when it actually works. `undefined` = not answered yet: keep the current behaviour
  // rather than flashing the button in and out, and treat omission as enabled (older servers).
  const [signupsEnabled, setSignupsEnabled] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void fetchAuthCapabilities()
      .then((capabilities) => {
        if (active) setSignupsEnabled(capabilities.signupsEnabled ?? true);
      })
      .catch(() => {
        // Capabilities unavailable: do not hide the entry point on a guess.
        if (active) setSignupsEnabled(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="flex min-h-full flex-col bg-background" data-rakazo-surface="welcome">
      <div className="app-drag flex gap-2 px-5 py-[18px]">
        <WindowChrome />
      </div>
      <main className="flex flex-1 flex-col items-center justify-center gap-11 px-5 pb-[90px]">
        <div className="flex items-center gap-[18px] sm:gap-[26px]">
          <div className="flex size-16 items-center justify-center gap-[9px] rounded-full bg-accent sm:size-[88px] sm:gap-[13px]">
            <span className="h-[17px] w-2 rounded-full bg-card sm:h-6 sm:w-[11px]" />
            <span className="h-[17px] w-2 rounded-full bg-card sm:h-6 sm:w-[11px]" />
          </div>
          <h1 className="text-[56px] leading-none tracking-[-0.03em] text-foreground sm:text-[76px]">
            Rakazo
          </h1>
        </div>
        <p className="max-w-[600px] text-center text-[27px] leading-[1.4] text-foreground/75">
          <Trans>
            Your team of always-on agents
            <br />
            that you can give real work to.
          </Trans>
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {signupsEnabled === false ? (
            // Registration is closed: make SIGN IN the primary action instead of offering a
            // button that cannot succeed.
            <Link
              to="/sign-in"
              data-testid="welcome-sign-in-primary"
              className="app-no-drag rounded-full bg-accent px-[34px] py-[15px] text-[19px] text-foreground transition hover:scale-[1.04] hover:bg-accent"
            >
              <Trans>Sign in</Trans>
              <span aria-hidden="true">&nbsp;&nbsp;→</span>
            </Link>
          ) : (
            <>
              <button
                type="button"
                data-testid="welcome-sign-up"
                onClick={() => navigate("/sign-up")}
                className="app-no-drag rounded-full bg-accent px-[34px] py-[15px] text-[19px] text-foreground transition hover:scale-[1.04] hover:bg-accent"
              >
                <Trans>Sign up</Trans>
                <span aria-hidden="true">&nbsp;&nbsp;→</span>
              </button>
              <Link
                to="/sign-in"
                className="app-no-drag rounded-full px-[34px] py-[15px] text-[19px] text-foreground/75 transition hover:text-foreground"
              >
                <Trans>Sign in</Trans>
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
