import { logger } from "./logger.js";

const CAPTCHA_POLL_INTERVAL = 5000;
const CAPTCHA_CREATE_TASK_URL = "https://api.2captcha.com/createTask";
const CAPTCHA_GET_RESULT_URL = "https://api.2captcha.com/getTaskResult";

export async function maybeSolveCaptcha(page, env) {
  if (!env.CAPTCHA_PROVIDER || !env.CAPTCHA_API_KEY) {
    return false;
  }

  if (env.CAPTCHA_PROVIDER !== "2captcha") {
    logger.warn("Unsupported captcha provider: %s", env.CAPTCHA_PROVIDER);
    return false;
  }

  const captchaMeta = await page.evaluate(() => {
    const siteKeyEl = document.querySelector("[data-sitekey]");
    let siteKey = siteKeyEl ? siteKeyEl.getAttribute("data-sitekey") : null;
    const hasTurnstile = Boolean(
      document.querySelector(".cf-turnstile") ||
        document.querySelector("input[name='cf-turnstile-response']")
    );
    const hasRecaptcha = Boolean(
      document.querySelector(".g-recaptcha") ||
        document.querySelector("textarea[name='g-recaptcha-response']")
    );
    let method = null;
    if (!siteKey) {
      const scriptSrcs = Array.from(document.querySelectorAll("script"))
        .map((script) => script.getAttribute("src"))
        .filter(Boolean);
      for (const src of scriptSrcs) {
        if (!src.includes("turnstile")) continue;
        try {
          const url = new URL(src, window.location.href);
          const key =
            url.searchParams.get("render") ||
            url.searchParams.get("k") ||
            url.searchParams.get("sitekey") ||
            url.searchParams.get("siteKey");
          if (key) {
            siteKey = key;
            break;
          }
        } catch {
          // ignore malformed script src
        }
      }
    }

    if (!siteKey) {
      const iframeSrcs = Array.from(document.querySelectorAll("iframe"))
        .map((frame) => frame.getAttribute("src"))
        .filter(Boolean);
      for (const src of iframeSrcs) {
        try {
          const url = new URL(src, window.location.href);
          const key =
            url.searchParams.get("k") ||
            url.searchParams.get("sitekey") ||
            url.searchParams.get("siteKey");
          if (key) {
            siteKey = key;
            break;
          }
        } catch {
          // ignore malformed iframe src
        }
      }
    }

    if (hasTurnstile) {
      method = "turnstile";
    } else if (hasRecaptcha) {
      method = "userrecaptcha";
    } else if (siteKey) {
      method = "turnstile";
    }
    return { siteKey, method };
  });

  if (!captchaMeta?.siteKey || !captchaMeta?.method) {
    return false;
  }
  if (String(captchaMeta.siteKey).trim().length < 20) {
    return false;
  }

  const pageUrl = page.url();
  logger.info("Captcha detected on %s", pageUrl);

  const userAgent = await page.evaluate(() => navigator.userAgent);
  const solution = await solveCaptchaTask(env, {
    pageUrl,
    siteKey: captchaMeta.siteKey,
    method: captchaMeta.method,
    userAgent
  });

  if (!solution?.token) {
    return false;
  }

  await page.evaluate((captchaToken) => {
    const inputs = [
      document.querySelector("input[name='cf-turnstile-response']"),
      document.querySelector("textarea[name='g-recaptcha-response']")
    ].filter(Boolean);
    for (const input of inputs) {
      input.value = captchaToken;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, solution.token);

  logger.info("Captcha token injected");
  return true;
}

export async function solveTurnstileToken(
  env,
  { pageUrl, siteKey, action, data, pagedata, userAgent }
) {
  if (!env.CAPTCHA_PROVIDER || !env.CAPTCHA_API_KEY) {
    return null;
  }

  if (env.CAPTCHA_PROVIDER !== "2captcha") {
    logger.warn("Unsupported captcha provider: %s", env.CAPTCHA_PROVIDER);
    return null;
  }

  if (!pageUrl || !siteKey) {
    return null;
  }

  return solveCaptchaTask(env, {
    pageUrl,
    siteKey,
    method: "turnstile",
    action,
    data,
    pagedata,
    userAgent
  });
}

async function solveCaptchaTask(
  env,
  { pageUrl, siteKey, method, action, data, pagedata, userAgent }
) {
  if (!pageUrl || !siteKey || !method) {
    return null;
  }
  if (typeof siteKey !== "string" || siteKey.trim().length < 5) {
    logger.error("2captcha: invalid siteKey for %s", pageUrl);
    return null;
  }

  const proxyConfig = getProxyTaskConfig(env);
  const task = buildCaptchaTask({
    method,
    pageUrl,
    siteKey: siteKey.trim(),
    action,
    data,
    pagedata,
    userAgent,
    proxyConfig
  });

  if (!task) {
    return null;
  }

  const taskId = await createTask(env.CAPTCHA_API_KEY, task);
  if (!taskId) {
    return null;
  }

  const solution = await pollTaskResult(env.CAPTCHA_API_KEY, taskId);
  if (!solution?.token) {
    return null;
  }

  return {
    token: solution.token,
    userAgent: solution.userAgent || userAgent
  };
}

function buildCaptchaTask({
  method,
  pageUrl,
  siteKey,
  action,
  data,
  pagedata,
  userAgent,
  proxyConfig
}) {
  const useProxy = Boolean(proxyConfig);
  if (method === "turnstile") {
    const task = {
      type: useProxy ? "TurnstileTask" : "TurnstileTaskProxyless",
      websiteURL: pageUrl,
      websiteKey: siteKey
    };
    if (action) task.action = action;
    if (data) task.data = data;
    if (pagedata) task.pagedata = pagedata;
    if (userAgent) task.userAgent = userAgent;
    if (useProxy) Object.assign(task, proxyConfig);
    return task;
  }

  if (method === "userrecaptcha") {
    const task = {
      type: useProxy ? "RecaptchaV2Task" : "RecaptchaV2TaskProxyless",
      websiteURL: pageUrl,
      websiteKey: siteKey
    };
    if (userAgent) task.userAgent = userAgent;
    if (useProxy) Object.assign(task, proxyConfig);
    return task;
  }

  logger.warn("Unsupported captcha method: %s", method);
  return null;
}

function getProxyTaskConfig(env) {
  const proxyType = env.CAPTCHA_PROXY_TYPE;
  const proxyAddress = env.CAPTCHA_PROXY_ADDRESS;
  const proxyPort = env.CAPTCHA_PROXY_PORT;
  if (!proxyType || !proxyAddress || !proxyPort) {
    return null;
  }
  const config = {
    proxyType,
    proxyAddress,
    proxyPort
  };
  if (env.CAPTCHA_PROXY_LOGIN) {
    config.proxyLogin = env.CAPTCHA_PROXY_LOGIN;
  }
  if (env.CAPTCHA_PROXY_PASSWORD) {
    config.proxyPassword = env.CAPTCHA_PROXY_PASSWORD;
  }
  return config;
}

async function createTask(apiKey, task) {
  const response = await fetch(CAPTCHA_CREATE_TASK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: apiKey,
      task
    })
  });

  const payload = await response.json().catch(() => null);
  if (!payload || payload.errorId !== 0) {
    logger.error(
      "2captcha createTask failed: %s (type=%s url=%s keyLen=%s)",
      payload?.errorDescription,
      task?.type,
      task?.websiteURL,
      task?.websiteKey ? String(task.websiteKey).length : "none"
    );
    return null;
  }
  logger.info("2captcha task created: %s", payload.taskId);
  return payload.taskId;
}

async function pollTaskResult(apiKey, taskId) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, CAPTCHA_POLL_INTERVAL));
    const response = await fetch(CAPTCHA_GET_RESULT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientKey: apiKey,
        taskId
      })
    });
    const payload = await response.json().catch(() => null);
    if (!payload) {
      continue;
    }
    if (payload.errorId && payload.errorId !== 0) {
      logger.error("2captcha getTaskResult error: %s", payload.errorDescription);
      return null;
    }
    if (payload.status === "ready") {
      logger.info("2captcha solution ready");
      return payload.solution;
    }
  }
  logger.error("2captcha timeout");
  return null;
}
