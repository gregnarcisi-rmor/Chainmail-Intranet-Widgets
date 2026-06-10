const fs = require('fs');
const path = require('path');
const https = require('https');

const domain = 'chainmailsolutions.atlassian.net';
const email = 'greg.narcisi@chainmailsolutions.ai';
const apiToken = process.env.JIRA_API_TOKEN || '';
const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');

const brainDir = 'C:\\Users\\greg_\\.gemini\\antigravity\\brain\\12aa9103-8688-4d2f-9a57-5aa10788d580';

function makeRequest(pathStr, method, payload = null) {
  return new Promise((resolve, reject) => {
    const data = payload ? JSON.stringify(payload) : null;
    const options = {
      hostname: domain,
      port: 443,
      path: pathStr,
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

function parseTicketFile(filePath, ticketId) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Extract title
  let title = '';
  const titleMatch = content.match(/\*\*Title:\*\*\s*(.*)/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/^[A-Z0-9-]+:\s*/i, '').trim();
  } else {
    const firstLine = content.split('\n')[0].trim();
    title = firstLine.replace(/^#\s*(Jira\s*Ticket:\s*)?\[?[A-Z0-9-]+\]?\s*/i, '').trim();
  }
  
  // Extract status
  let status = 'TODO';
  const statusMatch = content.match(/\*\*Status:\*\*\s*(.*)/i);
  if (statusMatch) {
    status = statusMatch[1].trim().toUpperCase();
  }
  
  // Extract description
  let description = '';
  const descMatch = content.match(/## Description\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (descMatch) {
    description = descMatch[1].trim();
  } else {
    description = `Task ${ticketId} details.`;
  }
  
  return { id: ticketId, title, status, description };
}

async function syncTicket(ticket) {
  console.log(`[Jira Sync] Processing ${ticket.id}...`);
  
  const summaryText = `[${ticket.id}] ${ticket.title}`;
  
  // 1. Search if ticket already exists
  const searchQuery = {
    jql: `project = OPS AND summary ~ "\\\\[${ticket.id}\\\\]"`,
    fields: ["id", "key", "status"]
  };
  
  let searchResult;
  try {
    searchResult = await makeRequest('/rest/api/3/search/jql', 'POST', searchQuery);
  } catch (err) {
    console.error(`[Jira Sync] Search request failed for ${ticket.id}:`, err.message);
    return;
  }
  
  let issueKey = null;
  let onlineStatus = null;
  
  if (searchResult && searchResult.issues && searchResult.issues.length > 0) {
    // Issue exists
    const existing = searchResult.issues[0];
    issueKey = existing.key;
    onlineStatus = existing.fields.status.name.toLowerCase();
    console.log(`[Jira Sync] Issue already exists online: ${issueKey} (${onlineStatus})`);
  } else {
    // 2. Create Issue
    console.log(`[Jira Sync] Creating new issue for ${ticket.id}...`);
    const createPayload = {
      fields: {
        project: { key: 'OPS' },
        summary: summaryText,
        description: { 
          type: 'doc', 
          version: 1, 
          content: [{ 
            type: 'paragraph', 
            content: [{ 
              type: 'text', 
              text: ticket.description 
            }] 
          }] 
        },
        issuetype: { name: 'Task' }
      }
    };
    
    try {
      const created = await makeRequest('/rest/api/3/issue', 'POST', createPayload);
      if (created && created.key) {
        issueKey = created.key;
        onlineStatus = 'to do'; // Default initial state
        console.log(`[Jira Sync] Created issue: ${issueKey}`);
      } else {
        console.error(`[Jira Sync] Failed to create issue for ${ticket.id}:`, created);
        return;
      }
    } catch (err) {
      console.error(`[Jira Sync] Create request error for ${ticket.id}:`, err.message);
      return;
    }
  }
  
  // 3. Transition to Done if needed
  if (ticket.status === 'DONE' && onlineStatus !== 'done' && onlineStatus !== 'closed') {
    console.log(`[Jira Sync] Transitioning ${issueKey} to Done...`);
    try {
      const transData = await makeRequest(`/rest/api/3/issue/${issueKey}/transitions`, 'GET');
      const doneTrans = transData.transitions ? transData.transitions.find(t => t.name.toLowerCase() === 'done') : null;
      if (doneTrans) {
        await makeRequest(`/rest/api/3/issue/${issueKey}/transitions`, 'POST', { transition: { id: doneTrans.id } });
        console.log(`[Jira Sync] Moved ${issueKey} to Done successfully.`);
      } else {
        console.log(`[Jira Sync] Transition 'Done' not found for ${issueKey}. Available:`, transData.transitions.map(t => t.name));
      }
    } catch (err) {
      console.error(`[Jira Sync] Transition failed for ${issueKey}:`, err.message);
    }
  } else {
    console.log(`[Jira Sync] No status transition needed for ${ticket.id} (Local: ${ticket.status}, Online: ${onlineStatus})`);
  }
}

async function run() {
  if (!fs.existsSync(brainDir)) {
    console.error(`Brain directory not found at ${brainDir}`);
    return;
  }
  
  console.log(`Scanning tickets in ${brainDir}...`);
  const files = fs.readdirSync(brainDir);
  const ticketFiles = files.filter(f => f.startsWith('jira_ticket_') && f.endsWith('.md'));
  
  console.log(`Found ${ticketFiles.length} ticket files to synchronize.`);
  
  const tickets = [];
  for (const file of ticketFiles) {
    const ticketId = file.match(/jira_ticket_([A-Z0-9-]+)\.md/)[1];
    const filePath = path.join(brainDir, file);
    const ticket = parseTicketFile(filePath, ticketId);
    tickets.push(ticket);
  }
  
  // Process sequentially to respect Jira API rate limits
  for (const ticket of tickets) {
    await syncTicket(ticket);
    console.log('----------------------------------------');
    await new Promise(r => setTimeout(r, 500)); // sleep 500ms
  }
  
  console.log('[Jira Sync] Finished synchronizing all tickets.');
}

run().catch(console.error);
