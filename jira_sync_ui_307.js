const https = require('https');

const domain = 'chainmailsolutions.atlassian.net';
const email = 'greg.narcisi@chainmailsolutions.com';
const apiToken = process.env.JIRA_API_TOKEN || '';
const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');

const task = {
  summary: '[UI-307] Dashboard UX Simplification: Tabbed Layout & Floating AI Chat',
  description: 'Reorganized the customer-facing dashboard into a clean, tabbed layout to prevent data overload for policyholders. Reorganized elements into three views: Overview (essential coverage & trigger information), Live Telemetry (sensor streams), and Property Profile (static structural attributes & satellite nudge tool). Converted the AI Chatbot sidebar into a floating chat widget (FAB) in the bottom-right corner to free up screen width. Mounted it globally at the application root (App.tsx), styled in the premium Slate & Gold brand theme.'
};

function makeRequest(path, method, payload = null) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : null;
    const options = {
      hostname: domain,
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      }
    };
    if (data) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request(options, res => {
      let respData = '';
      res.on('data', chunk => respData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(respData));
        } catch (e) {
          resolve(respData);
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log("Synchronizing UI-307 task to Jira Cloud...");
  try {
    const createPayload = {
      fields: {
        project: { key: 'OPS' },
        summary: task.summary,
        description: { 
          type: 'doc', 
          version: 1, 
          content: [{ 
            type: 'paragraph', 
            content: [{ 
              type: 'text', 
              text: task.description 
            }] 
          }] 
        },
        issuetype: { name: 'Task' }
      }
    };
    const issue = await makeRequest('/rest/api/3/issue', 'POST', createPayload);
    if (!issue.key) {
      console.log('Failed to create:', issue);
      return;
    }
    console.log(`Successfully created ${issue.key} for ${task.summary}`);
    
    const transData = await makeRequest(`/rest/api/3/issue/${issue.key}/transitions`, 'GET');
    const doneTrans = transData.transitions ? transData.transitions.find(t => t.name.toLowerCase() === 'done') : null;
    if (doneTrans) {
      await makeRequest(`/rest/api/3/issue/${issue.key}/transitions`, 'POST', { transition: { id: doneTrans.id } });
      console.log(`Moved ${issue.key} to Done!`);
    } else {
      console.log(`Transition 'Done' not found for ${issue.key}, current transitions:`, transData);
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

run().catch(console.error);
