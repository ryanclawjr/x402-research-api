const express = require("express");
const { paymentMiddleware } = require("x402-express");
const cors = require("cors");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());
app.use(cors());

// My payment address
const PAY_TO = "0x71f08aEfe062d28c7AD37344dC0D64e0adF8941E";

// Get CDP API key from environment (format: "name.secret" or full JWT)
const CDP_API_KEY = process.env.CDP_API_KEY;

// Generate JWT bearer token from CDP API key
async function createCDPToken() {
  if (!CDP_API_KEY) return {};
  
  // If it looks like a JWT already, return it
  if (CDP_API_KEY.split('.').length === 3) {
    return { Authorization: `Bearer ${CDP_API_KEY}` };
  }
  
  // If it's "name.secret" format, create JWT
  const parts = CDP_API_KEY.split('.');
  if (parts.length === 2) {
    const [name, secret] = parts;
    const token = jwt.sign({ sub: name }, secret, { algorithm: 'HS256', expiresIn: '1h' });
    return { Authorization: `Bearer ${token}` };
  }
  
  // Fallback: try as raw bearer
  return { Authorization: `Bearer ${CDP_API_KEY}` };
}

// x402 facilitator - CDP for mainnet
const facilitator = CDP_API_KEY ? {
  url: "https://api.cdp.coinbase.com/platform",
  createAuthHeaders: async () => {
    const token = await createCDPToken();
    return { verify: token, settle: token };
  }
} : undefined;

// x402 payment middleware
const payment = paymentMiddleware(PAY_TO, {
  "GET /api/search": {
    price: "$0.01",
    network: "base",
    config: {
      description: "Web search via Brave API - returns title, url, and snippet"
    }
  },
  "GET /api/fetch": {
    price: "$0.02",
    network: "base", 
    config: {
      description: "Fetch and extract readable content from any URL"
    }
  },
  "GET /api/analyze-github": {
    price: "$0.05",
    network: "base",
    config: {
      description: "Deep-dive analysis of GitHub projects - architecture, community, competitive landscape"
    }
  }
}, facilitator);

app.use(payment);

// Health check - free
app.get("/", (req, res) => {
  res.json({ 
    service: "RyanClaw Research API",
    version: "1.0.0",
    endpoints: {
      "/api/search": "Web search ($0.01)",
      "/api/fetch": "URL content extraction ($0.02)",
      "/api/analyze-github": "GitHub analysis ($0.05)"
    }
  });
});

// Web search endpoint
app.get("/api/search", async (req, res) => {
  const { q, count = 5 } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Missing query parameter 'q'" });
  }

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${count}`,
      {
        headers: {
          "Accept": "application/json",
          "X-Subscription-Token": process.env.BRAVE_API_KEY || ""
        }
      }
    );
    const data = await response.json();
    
    const results = (data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description
    }));
    
    res.json({ query: q, count: results.length, results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// URL fetch endpoint
app.get("/api/fetch", async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: "Missing URL parameter" });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "RyanClaw/1.0"
      }
    });
    const text = await response.text();
    
    // Simple extraction - get text content
    const extracted = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 5000);
    
    res.json({ url, extracted: extracted.substring(0, 2000), truncated: extracted.length > 2000 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GitHub analysis endpoint
app.get("/api/analyze-github", async (req, res) => {
  const { repo } = req.query;
  if (!repo) {
    return res.status(400).json({ error: "Missing repo parameter (e.g., 'facebook/react')" });
  }

  try {
    // Get repo info
    const repoRes = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { "User-Agent": "RyanClaw" }
    });
    const repoData = await repoRes.json();

    // Get stars over time (approximation via languages)
    const langRes = await fetch(`https://api.github.com/repos/${repo}/languages`, {
      headers: { "User-Agent": "RyanClaw" }
    });
    const langData = await langRes.json();

    // Get recent commits
    const commitsRes = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=5`, {
      headers: { "User-Agent": "RyanClaw" }
    });
    const commitsData = await commitsRes.json();

    const analysis = {
      name: repoData.name,
      full_name: repoData.full_name,
      description: repoData.description,
      stars: repoData.stargazers_count,
      forks: repoData.forks_count,
      open_issues: repoData.open_issues_count,
      language: repoData.language,
      languages: langData,
      created_at: repoData.created_at,
      updated_at: repoData.updated_at,
      license: repoData.license?.name,
      topics: repoData.topics,
      recent_commits: commitsData.map(c => ({
        sha: c.sha.substring(0, 7),
        message: c.commit.message.split('\n')[0],
        author: c.commit.author.name,
        date: c.commit.author.date
      }))
    };

    res.json({ analysis });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RyanClaw Research API running on port ${PORT}`);
  console.log(`Payment address: ${PAY_TO}`);
});
