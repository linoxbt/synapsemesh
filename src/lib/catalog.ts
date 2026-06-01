import type { AgentOp, NodeType } from "./sdk";

export type AgentBlueprint = {
  name: string;
  op: AgentOp;
  capabilities: string[];
  endpoint: string;
  metadataURI: string;
  description: string;
};

export const AGENT_BLUEPRINTS: AgentBlueprint[] = [
  {
    name: "Atlas Research Node",
    op: "Researcher",
    capabilities: ["source discovery", "market mapping", "evidence synthesis"],
    endpoint: "https://agents.synapsemesh.ai/atlas/research",
    metadataURI: "0g://agents/atlas-research-node",
    description: "Finds primary sources, compares claims and returns citation-ready research.",
  },
  {
    name: "Forge Code Auditor",
    op: "Coder",
    capabilities: ["solidity review", "test generation", "patch planning"],
    endpoint: "https://agents.synapsemesh.ai/forge/audit",
    metadataURI: "0g://agents/forge-code-auditor",
    description: "Reviews smart contracts, TypeScript clients and deployment scripts.",
  },
  {
    name: "Verity TEE Judge",
    op: "Verifier",
    capabilities: ["rubric scoring", "attestation checks", "quality arbitration"],
    endpoint: "https://agents.synapsemesh.ai/verity/judge",
    metadataURI: "0g://agents/verity-tee-judge",
    description: "Scores DAG node outputs against explicit rubrics before settlement.",
  },
  {
    name: "Mosaic Vision Scout",
    op: "Vision",
    capabilities: ["image inspection", "visual QA", "scene analysis"],
    endpoint: "https://agents.synapsemesh.ai/mosaic/vision",
    metadataURI: "0g://agents/mosaic-vision-scout",
    description: "Inspects image, UI and video frames for structured visual findings.",
  },
  {
    name: "Synthesis Desk",
    op: "Writer",
    capabilities: ["executive briefs", "technical writing", "release notes"],
    endpoint: "https://agents.synapsemesh.ai/synthesis/writer",
    metadataURI: "0g://agents/synthesis-desk",
    description: "Turns verified outputs into concise briefs, docs and launch copy.",
  },
  {
    name: "Relay Aggregator",
    op: "Aggregator",
    capabilities: ["result merging", "consensus", "DAG reduce steps"],
    endpoint: "https://agents.synapsemesh.ai/relay/aggregate",
    metadataURI: "0g://agents/relay-aggregator",
    description: "Combines multiple agent outputs into one reconciled final answer.",
  },
];

export type TaskTemplate = {
  title: string;
  description: string;
  nodes: Array<{
    label: string;
    type: NodeType;
    budget: number;
    deps: string[];
    inputSchema: string;
    outputSchema: string;
    qualityRubric: string;
    deadlineBlocks?: number;
  }>;
};

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    title: "Market intelligence brief",
    description: "Research, verify and summarize a market map with cited findings.",
    nodes: [
      {
        label: "Source discovery",
        type: "SEQUENTIAL",
        budget: 0.35,
        deps: [],
        inputSchema: "Topic, geography, time window and source-quality requirements.",
        outputSchema: "JSON array of sources with title, URL, date, publisher and relevance.",
        qualityRubric: "Score source authority, recency, diversity and topical relevance.",
      },
      {
        label: "Evidence synthesis",
        type: "SEQUENTIAL",
        budget: 0.45,
        deps: ["Source discovery"],
        inputSchema: "Source list and user research question.",
        outputSchema: "Structured findings grouped by trend, risk and opportunity.",
        qualityRubric: "Reward clear reasoning, source grounding and non-duplicative findings.",
      },
      {
        label: "Executive brief",
        type: "REDUCE",
        budget: 0.25,
        deps: ["Evidence synthesis"],
        inputSchema: "Verified findings and target audience.",
        outputSchema: "Markdown brief under 900 words with citations and action items.",
        qualityRubric: "Score clarity, completeness, citation use and decision usefulness.",
      },
    ],
  },
  {
    title: "Smart contract review",
    description: "Audit a contract, generate tests and produce an actionable risk report.",
    nodes: [
      {
        label: "Threat model",
        type: "SEQUENTIAL",
        budget: 0.3,
        deps: [],
        inputSchema: "Repository URL, contract list, deployment assumptions and protocol roles.",
        outputSchema: "Assets, trust boundaries, attacker goals and privileged actions.",
        qualityRubric: "Score coverage of access control, funds flow and external calls.",
      },
      {
        label: "Code analysis",
        type: "PARALLEL",
        budget: 0.55,
        deps: ["Threat model"],
        inputSchema: "Threat model plus source code and dependency versions.",
        outputSchema: "Findings with severity, exploit path, impact and affected lines.",
        qualityRubric: "Reward reproducible bugs and penalize speculative issues.",
      },
      {
        label: "Test plan",
        type: "PARALLEL",
        budget: 0.35,
        deps: ["Threat model"],
        inputSchema: "Threat model plus public contract interfaces.",
        outputSchema: "Unit/invariant test cases with setup and expected failure mode.",
        qualityRubric: "Score test specificity, feasibility and coverage of high-risk paths.",
      },
      {
        label: "Audit report",
        type: "REDUCE",
        budget: 0.3,
        deps: ["Code analysis", "Test plan"],
        inputSchema: "Validated findings and tests.",
        outputSchema: "Markdown report with summary, issues, fixes and residual risk.",
        qualityRubric: "Score prioritization, technical accuracy and remediation clarity.",
      },
    ],
  },
  {
    title: "Model evaluation report",
    description: "Run a benchmark-style review of model outputs and produce a scored report.",
    nodes: [
      {
        label: "Prompt suite design",
        type: "SEQUENTIAL",
        budget: 0.25,
        deps: [],
        inputSchema: "Target capability, user personas and evaluation constraints.",
        outputSchema: "Prompt set with expected behaviors and scoring dimensions.",
        qualityRubric: "Score coverage, edge cases and measurable criteria.",
      },
      {
        label: "Output grading",
        type: "PARALLEL",
        budget: 0.45,
        deps: ["Prompt suite design"],
        inputSchema: "Prompt set plus model outputs.",
        outputSchema: "Per-prompt scores with evidence and failure categories.",
        qualityRubric: "Reward consistent rubric application and evidence-backed scores.",
      },
      {
        label: "Evaluation summary",
        type: "REDUCE",
        budget: 0.2,
        deps: ["Output grading"],
        inputSchema: "Per-prompt scores, evidence and benchmark metadata.",
        outputSchema: "Report with aggregate scores, weaknesses and improvement plan.",
        qualityRubric: "Score statistical clarity, practical recommendations and caveats.",
      },
    ],
  },
  {
    title: "Customer support triage",
    description: "Classify, route and draft responses for a batch of support tickets.",
    nodes: [
      {
        label: "Ticket classification",
        type: "SEQUENTIAL",
        budget: 0.2,
        deps: [],
        inputSchema: "Ticket text, customer tier, product area and historical context.",
        outputSchema: "JSON with issue type, urgency, sentiment and required team.",
        qualityRubric: "Score classification accuracy and escalation judgment.",
      },
      {
        label: "Resolution lookup",
        type: "PARALLEL",
        budget: 0.25,
        deps: ["Ticket classification"],
        inputSchema: "Classified tickets plus knowledge-base excerpts.",
        outputSchema: "Relevant resolutions, policy links and confidence score.",
        qualityRubric: "Reward grounded answers and flag unsupported claims.",
      },
      {
        label: "Response drafting",
        type: "REDUCE",
        budget: 0.25,
        deps: ["Resolution lookup"],
        inputSchema: "Ticket, classification and approved resolution.",
        outputSchema: "Customer-ready reply with tone matched to urgency and tier.",
        qualityRubric: "Score empathy, correctness, policy compliance and concision.",
      },
    ],
  },
  {
    title: "Dataset labeling QA",
    description: "Audit labels, identify disagreement clusters and produce relabeling guidance.",
    nodes: [
      {
        label: "Schema inspection",
        type: "SEQUENTIAL",
        budget: 0.2,
        deps: [],
        inputSchema: "Dataset schema, label taxonomy and sample records.",
        outputSchema: "Ambiguity list, edge cases and label-quality checks.",
        qualityRubric: "Score taxonomy understanding and edge-case coverage.",
      },
      {
        label: "Sample audit",
        type: "PARALLEL",
        budget: 0.4,
        deps: ["Schema inspection"],
        inputSchema: "Sample records, labels and ambiguity guidance.",
        outputSchema: "Disputed records with proposed labels and explanations.",
        qualityRubric: "Reward precise disagreements and consistent relabel suggestions.",
      },
      {
        label: "QA report",
        type: "REDUCE",
        budget: 0.25,
        deps: ["Sample audit"],
        inputSchema: "Disputed records and proposed corrections.",
        outputSchema: "Quality report with error rates, examples and relabeling plan.",
        qualityRubric: "Score usefulness for label ops and statistical honesty.",
      },
    ],
  },
];
