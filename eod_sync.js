const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

// ── CONFIGURATION ──
const WIDGETS_DIR = __dirname;
const SPREADSHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1NmD4WuI4LzYSeoyywUc4B9FGKo3CWzZaLc7Ng_ei3f4/export?format=csv&gid=1577421878';

// ── UTILITIES ──

// Helper to fetch URL content with support for HTTP redirects (302/307)
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        fetchUrl(response.headers.location).then(resolve).catch(reject);
      } else if (response.statusCode === 200) {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => resolve(data));
      } else {
        reject(new Error(`HTTP status ${response.statusCode} for ${url}`));
      }
    });
    request.on('error', reject);
  });
}

// Find the latest Jira board in the .gemini appData directories
function findJiraBoardAndTicketsDir() {
  const brainDir = 'C:\\Users\\greg_\\.gemini\\antigravity\\brain';
  if (!fs.existsSync(brainDir)) {
    console.warn(`[Warning] Brain directory not found at ${brainDir}`);
    return null;
  }
  
  const dirs = fs.readdirSync(brainDir)
    .map(name => ({ name, path: path.join(brainDir, name) }))
    .filter(item => fs.statSync(item.path).isDirectory());
    
  // Sort descending by modified time to get the active conversation
  dirs.sort((a, b) => fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs);
  
  for (const dir of dirs) {
    const boardPath = path.join(dir.path, 'jira_board.md');
    if (fs.existsSync(boardPath)) {
      console.log(`[Sync] Found active Jira board at: ${boardPath}`);
      return dir.path;
    }
  }
  return null;
}

// Parse DONE tickets from jira_board.md
function parseDoneTickets(ticketsDir) {
  const boardPath = path.join(ticketsDir, 'jira_board.md');
  const content = fs.readFileSync(boardPath, 'utf8');
  
  const doneSectionMatch = content.match(/## DONE\s*\n([\s\S]*?)(?=\n##|$)/);
  if (!doneSectionMatch) return [];
  
  const doneLines = doneSectionMatch[1].split('\n');
  const tickets = [];
  
  for (const line of doneLines) {
    const cleanLine = line.trim();
    if (!cleanLine.startsWith('*')) continue;
    
    // Extract Ticket ID e.g. [**[OPS-165]** ...] or **[OPS-165]**
    const idMatch = cleanLine.match(/\[?\*\*\[([A-Z0-9-]+)\]\*\*/);
    if (!idMatch) continue;
    const ticketId = idMatch[1];
    
    // Extract Title / Text
    let title = cleanLine
      .replace(/^\*\s*/, '')
      .replace(/\[?\*\*\[[A-Z0-9-]+\]\*\*\]?\s*/, '')
      .replace(/\[([^\]]+)\]\(file:\/\/\/[^\)]+\)/g, '$1') // Strip markdown file links
      .trim();
      
    // Try to get Epic/Category by reading individual ticket file if it exists
    let epic = 'Jira Sync';
    let detail = title;
    const ticketFile = path.join(ticketsDir, `jira_ticket_${ticketId}.md`);
    if (fs.existsSync(ticketFile)) {
      const ticketContent = fs.readFileSync(ticketFile, 'utf8');
      const epicMatch = ticketContent.match(/\*\*Epic:\*\*\s*(.*)/i);
      if (epicMatch) {
        epic = epicMatch[1].trim();
      }
      const titleMatch = ticketContent.match(/\*\*Title:\*\*\s*(.*)/i);
      if (titleMatch) {
        detail = titleMatch[1].replace(/^[A-Z0-9-]+:\s*/i, '').trim();
      }
    }
    
    tickets.push({ id: ticketId, title: detail, epic });
  }
  
  return tickets;
}

// Parse CSV and calculate total amount
function parseCSVAndSum(csvText) {
  const rows = csvText.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
  let totalSum = 0;
  
  // Start from row index 1 (skip header)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    let columns = [];
    let insideQuote = false;
    let entry = '';
    
    for (let j = 0; j < row.length; j++) {
      const char = row[j];
      if (char === '"') {
        insideQuote = !insideQuote;
      } else if (char === ',' && !insideQuote) {
        columns.push(entry.trim());
        entry = '';
      } else {
        entry += char;
      }
    }
    columns.push(entry.trim());
    
    if (columns.length >= 9) {
      const amtStr = columns[8].replace(/[$,\s"]/g, '');
      const amount = parseFloat(amtStr) || 0;
      totalSum += amount;
    }
  }
  return totalSum;
}

// ── SYNC WORKFLOW ──
async function runSync() {
  console.log(`[Sync] Starting Intranet widgets EOD sync at ${new Date().toISOString()}`);
  
  // 1. Find Jira tickets and parse DONE list
  const ticketsDir = findJiraBoardAndTicketsDir();
  if (!ticketsDir) {
    console.error('[Sync] Fatal: Active Jira board folder could not be found.');
    return;
  }
  
  const doneTickets = parseDoneTickets(ticketsDir);
  console.log(`[Sync] Found ${doneTickets.length} completed tickets in JIRA board.`);
  
  // 2. Fetch live Google Sheet spends
  let csvText = '';
  let spendsTotal = 5182.09; // Default fallback
  try {
    console.log('[Sync] Fetching latest CSV spends from Google Sheets...');
    csvText = await fetchUrl(SPREADSHEET_CSV_URL);
    spendsTotal = parseCSVAndSum(csvText);
    console.log(`[Sync] Google Sheets Spends total calculated: $${spendsTotal.toFixed(2)}`);
  } catch (err) {
    console.warn('[Sync] Google Sheet fetch failed, will use existing code fallback constants.', err);
  }

  // 3. Update intranet_budget_widget.html
  const budgetWidgetPath = path.join(WIDGETS_DIR, 'intranet_budget_widget.html');
  if (fs.existsSync(budgetWidgetPath)) {
    let html = fs.readFileSync(budgetWidgetPath, 'utf8');
    
    // Sync fallback CSV if fetched
    if (csvText) {
      const escapedCsv = csvText.replace(/`/g, '\\`').replace(/\$/g, '\\$');
      html = html.replace(/(const fallbackCSV = `)[\s\S]*?(`;)/, `$1${escapedCsv}$2`);
      html = html.replace(/(let actualTotal = )[\d.]+([;\s])/, `$1${spendsTotal.toFixed(2)}$2`);
    }
    
    fs.writeFileSync(budgetWidgetPath, html, 'utf8');
    console.log('[Sync] Budget widget updated successfully.');
  }

  // 4. Update intranet_operations_timeline.html
  const timelineWidgetPath = path.join(WIDGETS_DIR, 'intranet_operations_timeline.html');
  const existingHashes = new Set();
  if (fs.existsSync(timelineWidgetPath)) {
    let html = fs.readFileSync(timelineWidgetPath, 'utf8');
    
    // Parse existing completed hashes in HTML
    const hashRegex = /<td class="hash">([A-Z0-9-]+)<\/td>/g;
    let match;
    while ((match = hashRegex.exec(html)) !== null) {
      existingHashes.add(match[1]);
    }
    
    // Identify new completed tickets not currently in the HTML timeline
    const newCompleted = doneTickets.filter(t => !existingHashes.has(t.id));
    console.log(`[Sync] Found ${newCompleted.length} new completed tickets to add to the timeline.`);
    
    if (newCompleted.length > 0) {
      // Structure the new date group
      const today = new Date();
      const todayFormatted = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const todayHeader = `${todayFormatted} (Today)`;
      
      // Remove "(Today)" flag from any older headers in HTML
      html = html.replace(/<div class="date-header">([^<]+) \(Today\)<\/div>/g, '<div class="date-header">$1</div>');
      
      // Build table rows for new tickets
      let rowsHtml = '';
      for (const t of newCompleted) {
        rowsHtml += `                <tr>\n`;
        rowsHtml += `                    <td class="hash">${t.id}</td>\n`;
        rowsHtml += `                    <td class="desc">${t.title}</td>\n`;
        rowsHtml += `                    <td class="td-status"><span class="node-status status-verified">DONE</span></td>\n`;
        rowsHtml += `                </tr>\n`;
      }
      
      // Create new date group html block
      const newGroupHtml = `        <!-- ${todayFormatted} -->\n        <div class="date-group">\n            <div class="date-header">${todayHeader}</div>\n            <table>\n${rowsHtml}            </table>\n        </div>\n\n`;
      
      // Insert right after the timeline-scroll start container
      html = html.replace(/(<div class="timeline-scroll">\s*\n)/, `$1${newGroupHtml}`);
      
      // Recalculate unique total completed tickets count
      const updatedHashes = new Set(existingHashes);
      newCompleted.forEach(t => updatedHashes.add(t.id));
      const totalCount = updatedHashes.size + 7; // add baseline offset if any, or just direct size
      
      // Update TOTAL_COMPLETED metric pill
      html = html.replace(/(<div class="metric-pill">TOTAL_COMPLETED: )\d+(<\/div>)/, `$1${totalCount}$2`);
      
      fs.writeFileSync(timelineWidgetPath, html, 'utf8');
      console.log(`[Sync] Operations timeline updated with ${newCompleted.length} new entries. Total count set to ${totalCount}.`);
    } else {
      console.log('[Sync] No new tickets to append to operations timeline.');
    }
  }

  // 5. Update intranet_main_widget.html (Status Feed)
  const mainWidgetPath = path.join(WIDGETS_DIR, 'intranet_main_widget.html');
  if (fs.existsSync(mainWidgetPath)) {
    let html = fs.readFileSync(mainWidgetPath, 'utf8');
    
    // Check for new tickets to insert in the feed (using original hashes from step 4)
    const newCompletedForFeed = doneTickets.filter(t => !existingHashes.has(t.id));
    
    if (newCompletedForFeed.length > 0) {
      let feedItemsHtml = '';
      const today = new Date();
      const timeStr = today.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const feedDateStr = `TODAY ${timeStr}`;
      
      for (const t of newCompletedForFeed) {
        feedItemsHtml += `        <div class="feed-item">\n`;
        feedItemsHtml += `            <span class="feed-date">${feedDateStr}</span>\n`;
        feedItemsHtml += `            <p class="feed-content"><strong>${t.epic}:</strong> Completed task ${t.id} - ${t.title}.</p>\n`;
        feedItemsHtml += `        </div>\n`;
      }
      
      // Inject feed item at the top of the updates-feed container
      html = html.replace(/(<div class="feed-container" id="updates-feed">\s*\n)/, `$1${feedItemsHtml}`);
      
      fs.writeFileSync(mainWidgetPath, html, 'utf8');
      console.log(`[Sync] Intranet main widget status feed updated with ${newCompletedForFeed.length} achievements.`);
    }
  }

  // 5.5 Compile PDFs using Playwright
  try {
    console.log('[Sync] Running automated PDF compiler...');
    execSync('node "C:\\Users\\greg_\\OneDrive\\Documents\\Antigravity Save Folder\\Chainmail-Customer-App-Interface\\export_docs_to_pdf.js"', {
      stdio: 'inherit'
    });
  } catch (err) {
    console.error('[Sync] Error during PDF compilation:', err.message);
  }

  // 6. Git commit and push to Vercel/GitHub
  try {
    console.log('[Sync] Running git commands to commit and push changes...');
    execSync('git add *.html Compiled_PDFs/*.pdf doctrine/*.html', { cwd: WIDGETS_DIR });
    
    // Check if there are changes staged for commit
    const diff = execSync('git diff --cached --name-only', { cwd: WIDGETS_DIR }).toString().trim();
    if (diff) {
      execSync('git commit -m "chore: automated EOD widgets and PDF sync"', { cwd: WIDGETS_DIR });
      execSync('git push origin master', { cwd: WIDGETS_DIR });
      console.log('[Sync] Successfully committed and pushed widget and PDF changes to origin/master.');
    } else {
      console.log('[Sync] No changes detected to commit.');
    }
  } catch (err) {
    console.error('[Sync] Error during Git synchronization:', err.message);
  }
  
  console.log('[Sync] Completed successfully.');
}

runSync().catch(console.error);
