import axios from "axios";

// CouchDB credentials from HAR file
const COUCH_URL = "https://couch-prod-eu-2.budgetbakers.com";
const COUCH_DB = "bb-fc7c437b-cff2-4257-a2fc-8f79a00abc8f";
const COUCH_LOGIN = "fc7c437b-cff2-4257-a2fc-8f79a00abc8f";
const COUCH_TOKEN = "6419e990-0c67-4128-9647-9dc4d6873329";

async function main() {
  console.log("=== Testing BudgetBakers CouchDB Access ===\n");

  const auth = Buffer.from(`${COUCH_LOGIN}:${COUCH_TOKEN}`).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  try {
    // 1. Test CouchDB connection
    console.log("1. Testing CouchDB connection...");
    const welcome = await axios.get(COUCH_URL, { headers });
    console.log("✓ CouchDB connected:", welcome.data);

    // 2. Get database info
    console.log("\n2. Getting database info...");
    const dbInfo = await axios.get(`${COUCH_URL}/${COUCH_DB}/`, { headers });
    console.log("✓ Database info:", dbInfo.data);

    // 3. Get all documents using _all_docs
    console.log("\n3. Getting all documents...");
    const allDocs = await axios.get(
      `${COUCH_URL}/${COUCH_DB}/_all_docs?include_docs=true&limit=1000`,
      { headers }
    );
    console.log("✓ Total docs fetched:", allDocs.data.rows?.length);
    
    // Collect all model types and accounts
    const modelTypes = new Map();
    const accounts = [];
    
    allDocs.data.rows?.forEach((row) => {
      const doc = row.doc;
      const type = doc?.reservedModelType;
      if (type) {
        modelTypes.set(type, (modelTypes.get(type) || 0) + 1);
      }
      if (type === "Account") {
        accounts.push(doc);
      }
    });
    
    console.log("\n=== MODEL TYPES COUNT ===");
    for (const [type, count] of modelTypes) {
      console.log(`- ${type}: ${count}`);
    }
    
    console.log("\n=== FIRST ACCOUNT STRUCTURE ===");
    if (accounts.length > 0) {
      console.log(JSON.stringify(accounts[0], null, 2));
    }
    
    // Get a Record (transaction)
    const records = allDocs.data.rows?.filter(r => r.doc?.reservedModelType === "Record").slice(0, 1);
    console.log("\n=== FIRST RECORD (TRANSACTION) STRUCTURE ===");
    if (records.length > 0) {
      console.log(JSON.stringify(records[0].doc, null, 2));
    }
    
    console.log("\n=== ACCOUNTS LIST (name, currency, excludeFromStats) ===");
    accounts.forEach((doc) => {
      console.log(`- ${doc.name}: ${doc.currencyCode || "?"} (exclude: ${doc.excludeFromStats || false})`);
    });

  } catch (error) {
    console.error("Error:", error.response?.status, error.response?.data || error.message);
  }
}

main();
