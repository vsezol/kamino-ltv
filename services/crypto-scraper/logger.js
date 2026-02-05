import pino from "pino";

const isPretty = process.env.NODE_ENV !== "production";

export const logger = pino({
  transport: isPretty
    ? {
        target: "pino-pretty",
        options: { colorize: true, translateTime: true }
      }
    : undefined
});
