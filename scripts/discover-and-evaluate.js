import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataFile = path.join(__dirname, '../data/projects.json');
const queueFile = path.join(__dirname, '../data/pending-projects.json');
const topicsFile = path.join(__dirname, '../data/topics.json');
const categoriesFile = path.join(__dirname, '../data/categories.json');
const rejectedFile = path.join(__dirname, '../data/rejected-projects.json');

const LLM_API_KEY = process.env.LLM_API_KEY || 'local-fallback';
const LLM_BASE_URL = process.env.LLM_BASE_URL || (LLM_API_KEY === 'local-fallback' ? 'http://127.0.0.1:11434/v1' : 'https://api.openai.com/v1');
const LLM_MODEL = process.env.LLM_MODEL || (LLM_API_KEY === 'local-fallback' ? 'llama3' : 'gpt-4o-mini');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DISCOVER_BATCH_SIZE = parseInt(process.env.DISCOVER_BATCH_SIZE || '10', 10);
const EVALUATE_BATCH_SIZE = parseInt(process.env.EVALUATE_BATCH_SIZE || '5', 10);

const MAX_PAGES_DEFAULT = parseInt(process.env.MAX_PAGES_DEFAULT || '5', 10);
const MAX_PAGES_QUALITY = parseInt(process.env.MAX_PAGES_QUALITY || '20', 10);
const QUALITY_TOPIC_THRESHOLD = parseInt(process.env.QUALITY_TOPIC_THRESHOLD || '5', 10);
const AUTO_FETCH_DESC_STARS = parseInt(process.env.AUTO_FETCH_DESC_STARS || '1000', 10);

const sessionFile = path.join(__dirname, '../data/discovery-session.json');

let apiRequestCount = 0;
function logApiCall(type, details = "") {
  apiRequestCount++;
  console.log(`  🌐 [API Request #${apiRequestCount}] Type: ${type} ${details ? `(${details})` : ""}`);
}

async function fetchRepoDetails(full_name) {
  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  if (GITHUB_TOKEN) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  }
  logApiCall("GitHub REST", `Fetch repo details for ${full_name}`);
  const res = await fetch(`https://api.github.com/repos/${full_name}`, { headers });
  if (!res.ok) return null;
  return await res.json();
}

function loadJson(filePath, defaultVal = null) {
  if (fs.existsSync(filePath)) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
    catch (e) { return defaultVal; }
  }
  return defaultVal;
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function askLLM(prompt) {
  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: 'You are an expert software curator. Your job is to strictly evaluate GitHub repositories and return JSON. Respond ONLY with valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`LLM API error: ${res.statusText} - ${txt}`);
  }

  const resData = await res.json();
  const content = resData.choices[0].message.content;
  let cleanContent = content.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleanContent);
}

// Helper to fetch extra repository info using GraphQL for efficiency
async function fetchBatchRepoInfo(batch, token) {
  if (!token) {
    console.error("  ⚠️  GITHUB_TOKEN is missing. GraphQL requests require a token.");
    return {};
  }

  logApiCall("GitHub GraphQL", `Bulk fetch ${batch.length} repos`);
  // Build a bulk GraphQL query using aliases
  let queryParts = "";
  batch.forEach((item, index) => {
    const [owner, repo] = item.full_name.split('/');
    // Check if names are valid to avoid injection/syntax errors
    if (!owner || !repo) return;

    // GraphQL aliases must start with a letter and contain only alphanumeric/underscores
    const alias = `repo_${index}`;
    queryParts += `
      ${alias}: repository(owner: "${owner}", name: "${repo}") {
        readme: object(expression: "HEAD:README.md") { ... on Blob { text } }
        readmeMain: object(expression: "main:README.md") { ... on Blob { text } }
        readmeMaster: object(expression: "master:README.md") { ... on Blob { text } }
        latestRelease {
          releaseAssets(first: 20) {
            nodes { name }
          }
        }
        object(expression: "HEAD:") {
          ... on Tree {
            entries { name }
          }
        }
      }
    `;
  });

  const query = `query { ${queryParts} }`;

  try {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query })
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`GraphQL error: ${res.status} - ${txt}`);
    }

    const data = await res.json();
    if (data.errors) {
      console.warn("  ⚠️  GraphQL returned some errors:", JSON.stringify(data.errors));
    }
    return data.data || {};
  } catch (err) {
    console.error(`  ⚠️  Bulk fetch failed: ${err.message}`);
    return {};
  }
}

// 1. Discover mode
async function discover() {
  const isResume = process.argv.includes('--resume');
  const isUpdateOnly = process.argv.includes('--update-only');

  if (process.argv.includes('--consume-only') && !isUpdateOnly) {
    console.log('⏭️ [Discovery] Skipped GitHub API discovery due to --consume-only flag.');
    return;
  }

  const session = loadJson(sessionFile, { lastTopic: null, lastPage: 0 }); // Always load session if it exists
  const topicsDb = loadJson(topicsFile, { active: {}, niche: {}, exhausted: {} });
  
  // Select topic
  const activeTopics = Object.keys(topicsDb.active);
  if (activeTopics.length === 0) {
    console.error(`❌ Topics DB has no active topics! Please initialize topics.json.`);
    return;
  }

  // CLI Args Parsing for topic selection
  const sortTopicByMatch = process.argv.find(arg => arg.startsWith('--sort-topic-by='));
  const sortTopicBy = sortTopicByMatch ? sortTopicByMatch.split('=')[1] : (isUpdateOnly ? 'quality' : 'time');

  const topicOrderMatch = process.argv.find(arg => arg.startsWith('--topic-order='));
  const topicOrder = topicOrderMatch ? topicOrderMatch.split('=')[1] : (sortTopicBy === 'quality' ? 'desc' : 'asc');

  // Sort topics
  activeTopics.sort((a, b) => {
    const topicA = topicsDb.active[a];
    const topicB = topicsDb.active[b];

    const timeA = new Date(topicA.lastExplored || 0).getTime();
    const timeB = new Date(topicB.lastExplored || 0).getTime();

    if (sortTopicBy === 'quality') {
      const scoreA = topicA.score || 0;
      const scoreB = topicB.score || 0;

      // If both are high quality, prioritize the one explored least recently (rotation)
      if (scoreA >= QUALITY_TOPIC_THRESHOLD && scoreB >= QUALITY_TOPIC_THRESHOLD) {
        return timeA - timeB;
      }

      if (scoreA !== scoreB) {
        return topicOrder === 'desc' ? scoreB - scoreA : scoreA - scoreB;
      }
    }

    // Default: Sort by lastExplored time (oldest first)
    if (timeA !== timeB) {
      return timeA - timeB;
    }

    return 0;
  });

  // Pick the topic to search
  let pickedTopic = activeTopics[0];
  let pageToExplore = 1;
  let isSticky = false;

  // Sticky topic logic with session
  if (session.lastTopic && activeTopics.includes(session.lastTopic)) {
    const sessionTopicScore = topicsDb.active[session.lastTopic].score || 0;
    const sessionMaxPages = sessionTopicScore >= QUALITY_TOPIC_THRESHOLD ? MAX_PAGES_QUALITY : MAX_PAGES_DEFAULT;

    if (session.lastPage < sessionMaxPages) {
      pickedTopic = session.lastTopic;
      pageToExplore = session.lastPage + 1;
      isSticky = true;
      console.log(`🔄 [Sticky] Continuing topic "${pickedTopic}" (${pageToExplore}/${sessionMaxPages})`);
    } else {
      console.log(`✅ [Sticky] Topic "${session.lastTopic}" exhausted. Finding next...`);
      if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);

      // Update exploration time for the exhausted topic
      if (topicsDb.active[session.lastTopic]) {
        topicsDb.active[session.lastTopic].lastExplored = new Date().toISOString();
      }

      // Pick next topic from sorted list
      const currentIdx = activeTopics.indexOf(session.lastTopic);
      const nextIdx = (currentIdx + 1) % activeTopics.length;
      pickedTopic = activeTopics[nextIdx];

      if (pickedTopic === session.lastTopic && activeTopics.length > 1) {
        pickedTopic = activeTopics[(nextIdx + 1) % activeTopics.length];
      }
    }
  }

  let topicScore = topicsDb.active[pickedTopic].score || 0;
  const githubMaxResults = 1000;
  const batchSize = Math.min(isUpdateOnly ? DISCOVER_BATCH_SIZE * 3 : DISCOVER_BATCH_SIZE, 100);

  // Recalculate maxPages based on batch size and GitHub limits
  const maxPagesPossible = Math.floor(githubMaxResults / batchSize);
  let maxPagesForTopic = Math.min(topicScore >= QUALITY_TOPIC_THRESHOLD ? MAX_PAGES_QUALITY : MAX_PAGES_DEFAULT, maxPagesPossible);

  // If not already sticky/resuming, determine start page
  if (!isSticky) {
    if (topicScore >= QUALITY_TOPIC_THRESHOLD) {
      pageToExplore = 1; // Start sequential dive for quality topics
      console.log(`🎯 [Sticky] High-quality topic detected. Starting deep dive for "${pickedTopic}"`);
    } else {
      pageToExplore = Math.floor(Math.random() * Math.min(maxPagesForTopic, maxPagesPossible)) + 1; // Random for others
    }
  }

  if (pageToExplore > maxPagesForTopic) {
    if (isSticky) {
      console.log(`✅ [Sticky] Topic "${pickedTopic}" reached GitHub pagination limit (${pageToExplore - 1}/${maxPagesPossible}). Clearing session.`);
      if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);

      // Update exploration time for the topic that just finished its deep dive
      topicsDb.active[pickedTopic].lastExplored = new Date().toISOString();

      // Pick next topic from sorted list
      const currentIdx = activeTopics.indexOf(pickedTopic);
      const nextIdx = (currentIdx + 1) % activeTopics.length;
      pickedTopic = activeTopics[nextIdx];

      // Ensure we don't pick the same topic if others are available
      if (pickedTopic === (session.lastTopic || activeTopics[0]) && activeTopics.length > 1) {
        pickedTopic = activeTopics[(nextIdx + 1) % activeTopics.length];
      }

      pageToExplore = 1;
      isSticky = false;
      topicScore = topicsDb.active[pickedTopic].score || 0; // Update local score for stats below
      console.log(`🏷️  Falling back to Next Topic: ${pickedTopic}`);

      // Re-calculate max pages for the new topic
      maxPagesForTopic = Math.min(topicScore >= QUALITY_TOPIC_THRESHOLD ? MAX_PAGES_QUALITY : MAX_PAGES_DEFAULT, maxPagesPossible);
    } else {
      pageToExplore = Math.max(1, maxPagesForTopic);
    }
  }

  console.log(`🏷️  Selected Topic for exploration: ${pickedTopic} (Score: ${topicScore}, Max Pages: ${maxPagesForTopic})`);

  // Update exploration time ONLY IF we are done or it's a random low-score exploration
  const isFinished = pageToExplore >= maxPagesForTopic;
  const isDeepDive = topicScore >= QUALITY_TOPIC_THRESHOLD;

  if (isFinished || !isDeepDive) {
    topicsDb.active[pickedTopic].lastExplored = new Date().toISOString();
  }

  const sortOptions = ['updated', 'stars', 'forks'];
  const randomSort = sortOptions[Math.floor(Math.random() * sortOptions.length)];
  const minStars = 500;

  const useTopic = Math.random() > 0.4;
  const q = useTopic ? `topic:${pickedTopic}` : pickedTopic;

  const searchUrl = `https://api.github.com/search/repositories?q=${q}+stars:>=${minStars}&sort=${randomSort}&order=desc&per_page=${batchSize}&page=${pageToExplore}`;

  console.log(`🔍 [GitHub Search] Using keyword/topic: "${q}"`);
  console.log(`🌐 Calling GitHub API: sort:${randomSort}, page:${pageToExplore}, stars:>=${minStars}`);

    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (GITHUB_TOKEN) {
      headers['Authorization'] = `token ${GITHUB_TOKEN}`;
    }

    try {
      logApiCall("GitHub Search", `Topic: ${pickedTopic}`);
      const res = await fetch(searchUrl, { headers });
      if (!res.ok) throw new Error(`GitHub search failed: ${res.statusText}`);
      const data = await res.json();
      
      if (data.items && data.items.length > 0) {
        const summary = data.items.map(item => `   - ${item.full_name} [★ ${item.stargazers_count}]`).join('\n');
        console.log(`📋 Search Results Summary:\n${summary}`);
      }
      
    const projectDb = loadJson(dataFile, { projects: [] });
    const pendingDb = loadJson(queueFile, { queue: [] });

    const projectUrlMap = new Map();
    projectDb.projects.forEach(p => projectUrlMap.set(p.url.toLowerCase(), p));

    const pendingUrls = new Set();
    pendingDb.queue.forEach(item => pendingUrls.add(item.html_url.toLowerCase()));

    let queuedCount = 0;
    let newTopicsCount = 0;
    let updatedProjectCount = 0;

    for (const item of data.items) {
      // Proactive description fetching
      if (!item.description && item.stargazers_count >= AUTO_FETCH_DESC_STARS) {
        console.log(`📡 [Proactive Fetch] Fetching description for ${item.full_name} (${item.stargazers_count} stars)...`);
        const details = await fetchRepoDetails(item.full_name);
        if (details && details.description) {
          item.description = details.description;
        }
      }

      // Collect new topics into topicsDB
      if (Array.isArray(item.topics)) {
        item.topics.forEach(t => {
          const lcT = t.toLowerCase();
          if (/[\u4e00-\u9fa5]/.test(lcT)) return; // Skip Chinese/non-searchable topics

          if (!topicsDb.active[lcT] && !topicsDb.niche[lcT] && !topicsDb.exhausted[lcT]) {
            topicsDb.niche[lcT] = { level: 2, lastExplored: "1970-01-01T00:00:00Z", added: new Date().toISOString(), score: 0 };
            newTopicsCount++;
          }
        });
      }

      const url = item.html_url.toLowerCase();
      const existingProject = projectUrlMap.get(url);

      if (existingProject) {
        // Already approved project, update its stats directly
        existingProject.stars = item.stargazers_count;
        existingProject.lastUpdated = item.pushed_at;
        existingProject.topics = item.topics || [];
        existingProject._lastChecked = new Date().toISOString();
        updatedProjectCount++;
      } else if (!pendingUrls.has(url) && !isUpdateOnly) {
        pendingDb.queue.push({
          name: item.name,
          html_url: item.html_url,
          full_name: item.full_name,
          description: item.description,
          topics: item.topics,
          stargazers_count: item.stargazers_count,
          pushed_at: item.pushed_at,
          added_to_queue: new Date().toISOString()
        });
        pendingUrls.add(url);
        queuedCount++;
      }
    }

    saveJson(topicsFile, topicsDb);
    if (newTopicsCount > 0) console.log(`🏷️  Added ${newTopicsCount} new topics to niche DB.`);

    if (updatedProjectCount > 0) {
      saveJson(dataFile, projectDb); // Save the updated project stats
      console.log(`🔄 Synced updated stats for ${updatedProjectCount} existing projects.`);
    }

    if (queuedCount > 0) {
      saveJson(queueFile, pendingDb);
      console.log(`📥 Added ${queuedCount} new projects to the local pending queue.`);
    } else {
      console.log(`📥 No new projects to add to the queue right now.`);
    }

    // Save or clear session state
    if (isDeepDive && !isFinished) {
      saveJson(sessionFile, { lastTopic: pickedTopic, lastPage: pageToExplore });
      console.log(`💾 [Session] Saved progress: ${pickedTopic} - Page ${pageToExplore}`);
    } else if (isFinished && fs.existsSync(sessionFile)) {
      const currentSession = loadJson(sessionFile);
      if (currentSession && currentSession.lastTopic === pickedTopic) {
        fs.unlinkSync(sessionFile);
        console.log(`🗑️ [Session] Cleared session for finished topic: ${pickedTopic}`);
      }
    }
  } catch (err) {
    console.error(`❌ Discovery failed: ${err.message}`);
  }
}

// 2. Evaluate mode
async function evaluate() {
  const pendingDb = loadJson(queueFile, { queue: [] });
  if (!pendingDb.queue || pendingDb.queue.length === 0) {
    console.log('✨ The pending queue is empty. Nothing to evaluate.');
    return;
  }

  const projectDb = loadJson(dataFile, { projects: [] });
  const categoriesDb = loadJson(categoriesFile, []);
  const rejectedDb = loadJson(rejectedFile, { rejected: [] });

  const validCategoriesStr = categoriesDb
    .map(c => `- ${c.id}: ${c.name} (${c.description})`)
    .join('\n');

  console.log(`🤖 Evaluating up to ${EVALUATE_BATCH_SIZE} projects using Model: ${LLM_MODEL}...`);

  const headers = { 'Accept': 'application/vnd.github.v3+json' };
  if (GITHUB_TOKEN) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  }

  const batch = pendingDb.queue.splice(0, EVALUATE_BATCH_SIZE);

  console.log(`  🌐 Bulk fetching repository details via GraphQL...`);
  const bulkInfo = await fetchBatchRepoInfo(batch, GITHUB_TOKEN);

  const batchData = batch.map((item, index) => {
    const repoData = bulkInfo[`repo_${index}`] || {};

    // Fallback logic for README across different branches/filenames
    const readmeText = (repoData.readme?.text || repoData.readmeMain?.text || repoData.readmeMaster?.text || "").slice(0, 2500);
    const releaseAssets = (repoData.latestRelease?.releaseAssets?.nodes || []).map(a => a.name.toLowerCase());
    const topFiles = (repoData.object?.entries || []).map(e => e.name);

    return {
      id: index,
      name: item.name,
      full_name: item.full_name,
      description: item.description || 'No description',
      topics: item.topics?.join(', ') || 'None',
      readme_snippet: readmeText,
      release_assets: releaseAssets.slice(0, 15),
      top_level_files: topFiles.slice(0, 20)
    };
  });

  // Fixing the ID mapping for the prompt
  batchData.forEach((d, i) => d.id = i);

  const prompt = `
Evaluate these GitHub repositories. Determine if they are high-quality END-USER application software (Desktop, Mobile, or CLI tools).
Strictly EXCLUDE: libraries, APIs, frameworks, boilerplates, templates, tutorials, collections of links, and low-quality projects.

Projects to evaluate:
${JSON.stringify(batchData, null, 2)}

Valid Categories:
${validCategoriesStr}

For each project:
1. Determine "is_valuable": true ONLY if it's a finished, usable application for end-users.
2. Carefully detect supported "platforms". Use repo topics, description, README content, and release assets (e.g., .exe/.msi for Windows, .dmg/.app for macOS, .apk/.aab for Android, .ipa for iOS).
3. Assign "categories" (IDs from the list above, can be multiple).
4. Provide "description": A concise, premium-feeling summary in Chinese (max 2 sentences).
5. Detect "is_cross_platform" and "health" status based on recent activity and star count.

Required Output Format (JSON):
{
  "evaluations": [
    {
      "id": 0,
      "is_valuable": true,
      "categories": ["productivity", "utilities"],
      "platforms": ["Windows", "macOS", "Linux"],
      "project": {
        "name": "Display Name",
        "description": "中文描述内容...",
        "tags": ["Tag1", "Tag2"],
        "health": "Active",
        "is_cross_platform": true
      }
    },
    {
      "id": 1,
      "is_valuable": false,
      "reason": "Specify why"
    }
  ]
}

Return ONLY standard JSON.`;

  try {
    const responseData = await askLLM(prompt);
    const evaluations = responseData.evaluations || [];

    let addedCount = 0;
    const topicsDb = loadJson(topicsFile);

    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      const evalData = evaluations.find(e => e.id === i);

      if (evalData && evalData.is_valuable && evalData.project && Array.isArray(evalData.categories)) {
        let projectToAdd = {
          ...evalData.project,
          url: item.html_url,
          stars: item.stargazers_count,
          lastUpdated: item.pushed_at,
          addedAt: new Date().toISOString(),
          _lastChecked: new Date().toISOString(),
          topics: item.topics || [],
          categories: evalData.categories,
          platforms: evalData.platforms || []
        };

        projectDb.projects.push(projectToAdd);
        console.log(`  ✅ Approved [${item.name}] -> Platforms: ${projectToAdd.platforms.join(', ')}`);
        addedCount++;

        // Update topic scores
        if (Array.isArray(item.topics)) {
          item.topics.forEach(t => {
            const lcT = t.toLowerCase();
            if (topicsDb.active[lcT]) topicsDb.active[lcT].score = (topicsDb.active[lcT].score || 0) + 1;
            else if (topicsDb.niche[lcT]) topicsDb.niche[lcT].score = (topicsDb.niche[lcT].score || 0) + 1;
          });
        }
      } else {
        const reason = evalData?.reason || 'Not a valuable end-user application';
        console.log(`  ❌ Rejected [${item.name}] -> ${reason}`);
        rejectedDb.rejected.push({
          name: item.name,
          url: item.html_url,
          description: item.description,
          rejected_at: new Date().toISOString(),
          reason: reason
        });
      }
    }

    saveJson(queueFile, pendingDb);
    saveJson(dataFile, projectDb);
    saveJson(rejectedFile, rejectedDb);
    saveJson(topicsFile, topicsDb);

    // Trending Category Sync
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    projectDb.projects.forEach(p => {
      const d = new Date(p.lastUpdated);
      const isTrending = d > threeMonthsAgo && (p.stars || 0) >= 1000;
      if (isTrending && !p.categories.includes('trending')) {
        p.categories.push('trending');
      }
    });
    saveJson(dataFile, projectDb);

    console.log(`\n🎉 Evaluated ${batch.length} projects. Added ${addedCount} new applications.`);
  } catch (err) {
    console.error(`🚨 Evaluation failed: ${err.message}`);
    // Put back the batch into queue if it failed
    pendingDb.queue.unshift(...batch);
    saveJson(queueFile, pendingDb);
  }
}

async function initTopics() {
  const topicsDb = loadJson(topicsFile);
  const projectDb = loadJson(dataFile, { projects: [] });
  let updates = 0;

  for (const t in topicsDb.active) topicsDb.active[t].score = 0;
  for (const t in topicsDb.niche) topicsDb.niche[t].score = 0;

  projectDb.projects.forEach(p => {
    const tagsToSync = [...(p.topics || []), ...(p.tags || [])];
    tagsToSync.forEach(tag => {
      const lcT = tag.toLowerCase();
      if (topicsDb.active[lcT]) {
        topicsDb.active[lcT].score = (topicsDb.active[lcT].score || 0) + 1;
        updates++;
      } else if (topicsDb.niche[lcT]) {
        topicsDb.niche[lcT].score = (topicsDb.niche[lcT].score || 0) + 1;
        updates++;
      }
    });
  });

  saveJson(topicsFile, topicsDb);
  console.log(`✅ Topics initialized. Updated ${updates} topic scores.`);
  process.exit(0);
}

async function run() {
  if (process.argv.includes('--init-topics')) {
    await initTopics();
    return;
  }
  await discover();
  if (!process.argv.includes('--update-only')) {
    await evaluate();
  } else {
    console.log('⏭️ [Update Mode] Skipped evaluate() stage.');
  }
}

run().catch(console.error);
