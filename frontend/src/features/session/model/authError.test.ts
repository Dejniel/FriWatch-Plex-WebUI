import axios from "axios";
import { authErrorMessage, UnclaimedPlexServerError } from "./authError";
import { PlexRequestError } from "shared/api/PlexClient";
import { PlexResponseError } from "shared/api/plexResponse";

function responseError(status: number, data?: unknown) {
  return new axios.AxiosError(
    "Request failed",
    undefined,
    undefined,
    undefined,
    { status, data, headers: {}, config: {} as any, statusText: "" },
  );
}

describe("authErrorMessage", () => {
  it("identifies an expired Plex sign-in request", () => {
    expect(
      authErrorMessage(
        responseError(404, { errors: [{ code: 1020 }] }),
        "loginCallback",
      ),
    ).toContain("expired");
  });

  it("does not describe every unauthorized request as an incorrect PIN", () => {
    expect(authErrorMessage(responseError(401), "account")).toContain(
      "session has expired",
    );
    expect(authErrorMessage(responseError(401), "profile")).toBe(
      "Incorrect profile PIN.",
    );
    expect(authErrorMessage(responseError(403), "server")).toContain(
      "does not have access",
    );
  });

  it("distinguishes network errors from rejected credentials", () => {
    const error = new axios.AxiosError("Network Error", "ERR_NETWORK");
    expect(authErrorMessage(error, "profiles")).toContain("network connection");
  });

  it("separates unclaimed servers, access denial, timeouts and malformed context", () => {
    expect(authErrorMessage(new UnclaimedPlexServerError(), "server")).toContain("has not been claimed");
    expect(authErrorMessage(new PlexRequestError(401, {}), "server")).toContain("signing in again");
    expect(authErrorMessage(new PlexRequestError(504, {}), "server")).toContain("too long");
    expect(authErrorMessage(new PlexResponseError("server details"), "server")).toContain("incomplete server information");
  });
});
