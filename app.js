require("dotenv").config();
const express = require("express");
const cors = require('cors');
const bodyParser = require("body-parser");
const { tool } = require("@langchain/core/tools");
const { z } = require("zod");
const { ChatOpenAI } = require("@langchain/openai");
const { MessagesAnnotation, StateGraph } = require("@langchain/langgraph");
const { ToolNode } = require("@langchain/langgraph/prebuilt");
const multer = require("multer");
const { uploadToDrive } = require('./modules/driveUploader');

const storage = multer.memoryStorage();
const upload = multer({ storage });

const llm = new ChatOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    modelName: "gpt-4o-2024-11-20"
});

const astrologyPrompt = tool(
    async({ name, dob, tob, pob, gender, palmLeft, palmRight }) => {
        return `
            User Info:
            - Name: ${name}
            - Date of Birth: ${dob}
            - Time of Birth: ${tob}
            - Place of Birth: ${pob}
            - Gender: ${gender}
            - Palm Image 1: ${palmLeft}
            - Palm Image 2: ${palmRight}
        `;
    },
    {
        name: "Astro_AI",
        description: "Asrology prediction system",
        schema: z.object({
        name: z.string().describe("name of the user"),
        dob: z.string().describe("date of birth of the user"),
        tob: z.string().describe("time of birth of the user"),
        pob: z.string().describe("place of birth of the user"),
        gender: z.string().describe("gender of the user"),
        palmLeft: z.string().describe("palm image of the user"),
        palmRight: z.string().describe("palm image of the user")
        }),
    }
);

const tools = [astrologyPrompt];
const toolsByName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
const llmWithTools = llm.bindTools(tools);

async function llmCall(state) {
  const result = await llmWithTools.invoke([
    {
      role: "system",
      content: `You are an expert in Indian Astrology, Vedic Astronomy, Numerology, and Palmistry.
      Generate a detailed, personalized report combining insights from:
        - Vedic Astrology (including planetary positions and yogas)
        - Indian Astronomy (nakshatra-based analysis)
        - Numerology (based on birth date and name)
        - Palmistry (generalized based on typical palm features if no palm image is available)
      Tasks:
        1. Generate a complete Vedic chart (Kundli) in table format.
        2. Create a combined astrological profile that includes the following sections:
          - Past life and childhood influences
          - Present challenges and career path
          - Marriage prediction (timing, type, characteristics of partner, love/arranged)
          - Wealth and financial outlook
          - Astrological yogas (if any) and their impact
          - Remedies (gemstones, mantras, fasts, rituals)
          - Timeline of major life events (in a table)
                `
    },
    ...state.messages
  ]);

  return {
    messages: [result]
  };
}

const toolNode = new ToolNode(tools);

function shouldContinue(state) {
  const messages = state.messages;
  const lastMessage = messages.at(-1);

  if (lastMessage?.tool_calls?.length) {
    return "Action";
  }
  return "__end__";
}

const agentBuilder = new StateGraph(MessagesAnnotation)
  .addNode("llmCall", llmCall)
  .addNode("tools", toolNode)
  .addEdge("__start__", "llmCall")
  .addConditionalEdges(
    "llmCall",
    shouldContinue,
    {
      "Action": "tools",
      "__end__": "__end__",
    }
  )
  .addEdge("tools", "llmCall")
  .compile();

const app = express();
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://astro-ai-fe.vercel.app/'
  ]
}));
app.use(bodyParser.json());

function formatFilename(originalName, userName) {
  const now = new Date();
  const date = now.toLocaleDateString('en-GB').replace(/\//g, '-');
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  const time = `${hours}-${minutes}${ampm}`;

  const cleanUserName = userName.replace(/\s+/g, '_');
  return `${cleanUserName}_${date}_${time}_${originalName}`;
}

app.post("/read", upload.fields([
    { name: 'palmLeft', maxCount: 1 },
    { name: 'palmRight', maxCount: 1 }
  ]), async (req, res) => {
  try {
    const { name, dob, tob, pob, gender } = req.body;
    const palmLeftFile = req.files.palmLeft?.[0];
    const palmRightFile = req.files.palmRight?.[0];

    if (!palmLeftFile || !palmRightFile) {
      return res.status(400).json({ error: "Both palm images are required." });
    }

    const formattedPalmLeftName = formatFilename(palmLeftFile.originalname, name);
    const formattedPalmRightName = formatFilename(palmRightFile.originalname, name);

    const palmLeftUrl = await uploadToDrive(palmLeftFile.buffer, formattedPalmLeftName, palmLeftFile.mimetype);
    const palmRightUrl = await uploadToDrive(palmRightFile.buffer, formattedPalmRightName, palmRightFile.mimetype);

    const userData = {
      name,
      dob,
      tob,
      pob,
      gender,
      palmLeft: palmLeftUrl,
      palmRight: palmRightUrl,
    };
    
    const messages = [{
    role: "user",
    content: "Generate an astrology report for the following user: "+JSON.stringify(userData)
    }];

    const result = await agentBuilder.invoke({ messages });
    const msg = result.messages;

    console.log("✅ Reading:", msg[3].content);
    res.json({result: msg[3].content});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));