import packageJson from "../../package.json" with { type: "json" };

export const SUPPORTED_HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

export const packageVersion =
  typeof packageJson?.version === "string" ? packageJson.version : "1.0.0";

export const DEFAULT_SWAGGER_ROUTE = "/swagger";
export const DEFAULT_SWAGGER_TITLE = "AI Kit API";

