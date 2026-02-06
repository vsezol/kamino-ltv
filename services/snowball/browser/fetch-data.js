const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');

async function fetchData(email, password) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  let context;
  let needLogin = true;

  try {
    if (fs.existsSync(STATE_FILE)) {
      console.error('Loading saved browser state...');
      try {
        context = await browser.newContext({
          storageState: STATE_FILE,
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          viewport: { width: 1280, height: 720 }
        });
        const page = await context.newPage();
        
        await page.goto('https://snowball-income.com/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
        
        if (page.url().includes('/dashboard')) {
          console.error('Browser state is valid, skipping login');
          needLogin = false;
        } else {
          console.error('Browser state expired, will perform login');
          await context.close();
        }
      } catch (err) {
        console.error('Failed to load state, will perform login:', err.message);
        if (context) await context.close();
      }
    }

    if (needLogin) {
      console.error('Performing login...');
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
      });
      const page = await context.newPage();

      await page.goto('https://snowball-income.com/auth/login', { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForSelector('input[placeholder="Email"]', { timeout: 30000 });
      
      await page.fill('input[placeholder="Email"]', email);
      await page.fill('input[placeholder="Пароль"]', password);
      await page.waitForTimeout(500);

      await page.keyboard.press('Enter');
      await page.waitForURL('**/dashboard**', { timeout: 60000 });
      await page.waitForTimeout(3000);

      console.error('Login successful, saving state...');
      await context.storageState({ path: STATE_FILE });
    }

    const page = context.pages()[0] || await context.newPage();
    
    if (!page.url().includes('/dashboard')) {
      await page.goto('https://snowball-income.com/dashboard', { waitUntil: 'networkidle', timeout: 30000 });
    }

    console.error('Fetching portfolios via page.evaluate...');
    
    // #region agent log H3/H4
    console.error('[DEBUG-H3] Waiting 5 seconds for page to stabilize...');
    await page.waitForTimeout(5000);
    console.error('[DEBUG-H4] Current URL:', page.url());
    // #endregion
    
    const result = await page.evaluate(async () => {
      const diagnostics = {
        cookieLength: document.cookie.length,
        cookiePreview: document.cookie.substring(0, 200),
        hasCookies: document.cookie.length > 0,
        localStorage: {},
        sessionStorage: {},
        cookiesParsed: {},
        // #region agent log H6
        authToken: null,
        authTokenSource: null
        // #endregion
      };
      
      // #region agent log H7
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) {
            const value = localStorage.getItem(key);
            if (value && value.length < 500) {
              diagnostics.localStorage[key] = value;
            } else if (value) {
              diagnostics.localStorage[key] = `[${value.length} chars]`;
            }
          }
        }
      } catch (e) {
        diagnostics.localStorage = { error: e.message };
      }
      // #endregion
      
      // #region agent log H8
      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key) {
            const value = sessionStorage.getItem(key);
            if (value && value.length < 500) {
              diagnostics.sessionStorage[key] = value;
            } else if (value) {
              diagnostics.sessionStorage[key] = `[${value.length} chars]`;
            }
          }
        }
      } catch (e) {
        diagnostics.sessionStorage = { error: e.message };
      }
      // #endregion
      
      // #region agent log H9
      try {
        document.cookie.split(';').forEach(cookie => {
          const [name, ...valueParts] = cookie.trim().split('=');
          const value = valueParts.join('=');
          if (name && value && value.length < 200) {
            diagnostics.cookiesParsed[name] = value;
          } else if (name && value) {
            diagnostics.cookiesParsed[name] = `[${value.length} chars]`;
          }
        });
      } catch (e) {
        diagnostics.cookiesParsed = { error: e.message };
      }
      // #endregion
      
      // #region agent log H6 - extract token from localStorage
      try {
        const authData = localStorage.getItem('persist:snowball-auth');
        if (authData) {
          const parsed = JSON.parse(authData);
          if (parsed.accessToken) {
            diagnostics.authToken = parsed.accessToken.replace(/"/g, '');
            diagnostics.authTokenSource = 'localStorage.persist:snowball-auth.accessToken';
          } else if (parsed.tokens) {
            const tokens = typeof parsed.tokens === 'string' ? JSON.parse(parsed.tokens) : parsed.tokens;
            if (tokens.accessToken) {
              diagnostics.authToken = tokens.accessToken;
              diagnostics.authTokenSource = 'localStorage.persist:snowball-auth.tokens.accessToken';
            }
          } else {
            diagnostics.authTokenSource = 'parsed but no token found, keys: ' + Object.keys(parsed).join(', ');
          }
        }
      } catch (e) {
        diagnostics.authTokenSource = 'error parsing: ' + e.message;
      }
      // #endregion
      
      try {
        const headers = {
          'Content-Type': 'application/json',
          'x-instance': 'ru',
          'x-user-locale': 'ru-RU',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
          'Origin': 'https://snowball-income.com',
          'Referer': 'https://snowball-income.com/dashboard'
        };
        
        // #region agent log H6 - add Bearer token if found
        if (diagnostics.authToken) {
          headers['Authorization'] = `Bearer ${diagnostics.authToken}`;
        }
        // #endregion
        
        const resp = await fetch('https://snowball-income.com/extapi/api/DashboardStats/portfolio-list', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ currency: 'USD', items: [], inOneCurrency: true }),
          credentials: 'include'
        });

        diagnostics.responseStatus = resp.status;
        diagnostics.responseHeaders = Object.fromEntries([...resp.headers.entries()]);
        
        const responseText = await resp.text();
        diagnostics.responseBodyPreview = responseText.substring(0, 200);

        if (!resp.ok) {
          return {
            success: false,
            error: `API returned ${resp.status}: ${responseText}`,
            diagnostics
          };
        }

        return {
          success: true,
          data: JSON.parse(responseText),
          diagnostics
        };
      } catch (e) {
        diagnostics.fetchError = e.message;
        return {
          success: false,
          error: `API fetch failed: ${e.message}`,
          diagnostics
        };
      }
    });

    // #region agent log H1/H2/H5/H6/H7/H8/H9
    console.error('[DEBUG-H1] document.cookie length:', result.diagnostics.cookieLength);
    console.error('[DEBUG-H1] document.cookie preview:', result.diagnostics.cookiePreview);
    console.error('[DEBUG-H2] Has cookies:', result.diagnostics.hasCookies);
    console.error('[DEBUG-H6] Auth token found:', !!result.diagnostics.authToken);
    console.error('[DEBUG-H6] Auth token source:', result.diagnostics.authTokenSource);
    if (result.diagnostics.authToken) {
      console.error('[DEBUG-H6] Token preview:', result.diagnostics.authToken.substring(0, 50) + '...');
    }
    console.error('[DEBUG-H7] localStorage keys:', Object.keys(result.diagnostics.localStorage).join(', '));
    console.error('[DEBUG-H8] sessionStorage keys:', Object.keys(result.diagnostics.sessionStorage).join(', '));
    console.error('[DEBUG-H9] Cookie count:', Object.keys(result.diagnostics.cookiesParsed).length);
    if (result.diagnostics.responseStatus) {
      console.error('[DEBUG-H5] Response status:', result.diagnostics.responseStatus);
      if (result.diagnostics.responseStatus !== 200) {
        console.error('[DEBUG-H5] Response headers:', JSON.stringify(result.diagnostics.responseHeaders));
        console.error('[DEBUG-H5] Response body preview:', result.diagnostics.responseBodyPreview);
      }
    }
    if (result.diagnostics.fetchError) {
      console.error('[DEBUG-H5] Fetch error:', result.diagnostics.fetchError);
    }
    // #endregion

    if (!result.success) {
      throw new Error(result.error);
    }

    const portfolios = result.data;

    console.error(`Successfully fetched ${portfolios.length} portfolios`);

    console.log(JSON.stringify({
      success: true,
      portfolios: portfolios,
      error: null
    }));

  } catch (error) {
    console.error('Error:', error.message);
    console.log(JSON.stringify({
      success: false,
      portfolios: [],
      error: error.message
    }));
    process.exit(1);
  } finally {
    await browser.close();
  }
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log(JSON.stringify({
    success: false,
    portfolios: [],
    error: 'Usage: node fetch-data.js <email> <password>'
  }));
  process.exit(1);
}

fetchData(args[0], args[1]);
