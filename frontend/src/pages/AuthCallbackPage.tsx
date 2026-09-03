import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import LogoMark from "../components/LogoMark";
import LoadingState from "../components/ui/loading-state";
import { consumeChatGPTOAuthReturn, finishChatGPTSignIn } from "../auth/chatgptOAuth";

/** Landing target for the ChatGPT OAuth round trip: ?code= → session → studio. */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = (params.get("code") ?? "").trim();
    const returnedState = (params.get("state") ?? "").trim();
    const providerError = (params.get("error_description") ?? params.get("error") ?? "").trim();
    if (providerError) {
      setError(providerError.slice(0, 240));
      return;
    }
    if (!code) {
      setError("The sign-in response did not include an authorization code.");
      return;
    }
    const { returnTo, expectedState } = consumeChatGPTOAuthReturn();
    if (expectedState && returnedState !== expectedState) {
      setError("The sign-in response did not match this browser session. Start again from sign-in.");
      return;
    }
    let active = true;
    void finishChatGPTSignIn(code)
      .then(() => {
        if (active) navigate(returnTo, { replace: true });
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : "ChatGPT sign-in failed.");
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground" aria-busy={!error}>
      <div className="flex max-w-sm flex-col items-center text-center">
        <span className="brand-mark mb-4 h-10 w-10"><LogoMark /></span>
        {error ? (
          <>
            <h1 className="text-lg font-semibold">Sign-in did not complete</h1>
            <p role="alert" className="mt-2 text-sm leading-6 text-muted-foreground">{error}</p>
            <Link to="/auth" className="secondary-button mt-5 h-9 px-4">Back to sign-in</Link>
          </>
        ) : (
          <>
            <h1 className="sr-only">Finishing sign-in</h1>
            <LoadingState label="Finishing sign-in" variant="Drive" />
          </>
        )}
      </div>
    </main>
  );
}
