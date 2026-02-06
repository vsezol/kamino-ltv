// Run this script in browser console at https://web.budgetbakers.com after login
// Copy the output and paste into your dashboard

(async () => {
  try {
    // Get session with JWT token
    const sessionRes = await fetch('/api/auth/session');
    const session = await sessionRes.json();
    
    if (!session?.user?.bbJwtToken) {
      console.error('❌ Not logged in! Please login first.');
      return;
    }
    
    // Get user data with CouchDB credentials
    const userRes = await fetch('/api/trpc/user.getUser?batch=1&input=' + encodeURIComponent(JSON.stringify({"0":{"json":null,"meta":{"values":["undefined"]}}})));
    const userData = await userRes.json();
    
    const user = userData?.[0]?.result?.data?.json;
    if (!user?.replication) {
      console.error('❌ Could not get CouchDB credentials');
      return;
    }
    
    const credentials = {
      userId: user.userId,
      email: user.email,
      couchUrl: user.replication.url,
      couchDb: user.replication.dbName,
      couchLogin: user.replication.login,
      couchToken: user.replication.token,
    };
    
    console.log('✅ BudgetBakers Credentials:');
    console.log(JSON.stringify(credentials, null, 2));
    
    // Copy to clipboard
    await navigator.clipboard.writeText(JSON.stringify(credentials));
    console.log('\n📋 Copied to clipboard!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
})();
