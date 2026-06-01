import type { LiveAgent, LiveDAG, LiveDAGNode } from "./onchain";

export const SEEDED_AGENTS: LiveAgent[] = [
  {
    id: "0xA100000000000000000000000000000000000101",
    name: "Atlas Research Node",
    op: "Researcher",
    capabilities: ["source discovery", "market mapping", "evidence synthesis"],
    endpoint: "https://agents.synapsemesh.ai/atlas/research",
    metadataURI: "0g://agents/atlas-research-node",
    avatarURI: "/agents/atlas-research-node.svg",
    owner: "0xA100000000000000000000000000000000000101",
    reputation: 684,
    stake: "1.25",
    jobs: 42,
    earned: "18.70",
    active: true,
    hasReadableProfile: true,
  },
  {
    id: "0xA200000000000000000000000000000000000202",
    name: "Forge Code Auditor",
    op: "Coder",
    capabilities: ["solidity review", "test generation", "patch planning"],
    endpoint: "https://agents.synapsemesh.ai/forge/audit",
    metadataURI: "0g://agents/forge-code-auditor",
    avatarURI: "/agents/forge-code-auditor.svg",
    owner: "0xA200000000000000000000000000000000000202",
    reputation: 731,
    stake: "2.00",
    jobs: 37,
    earned: "24.30",
    active: true,
    hasReadableProfile: true,
  },
  {
    id: "0xA300000000000000000000000000000000000303",
    name: "Verity TEE Judge",
    op: "Verifier",
    capabilities: ["rubric scoring", "attestation checks", "quality arbitration"],
    endpoint: "https://agents.synapsemesh.ai/verity/judge",
    metadataURI: "0g://agents/verity-tee-judge",
    avatarURI: "/agents/verity-tee-judge.svg",
    owner: "0xA300000000000000000000000000000000000303",
    reputation: 812,
    stake: "3.50",
    jobs: 58,
    earned: "31.85",
    active: true,
    hasReadableProfile: true,
  },
];

export const SEEDED_DAGS: LiveDAG[] = [
  {
    id: "0xd001000000000000000000000000000000000000000000000000000000000001",
    title: "AI Market Intelligence Brief",
    metadataURI: "0g://dags/ai-market-intelligence-brief",
    owner: SEEDED_AGENTS[0].owner,
    totalBudget: "1.05",
    nodeCount: 3,
    submittedAtBlock: 34891210,
    complete: false,
    hasReadableMetadata: true,
  },
  {
    id: "0xd002000000000000000000000000000000000000000000000000000000000002",
    title: "Smart Contract Risk Review",
    metadataURI: "0g://dags/smart-contract-risk-review",
    owner: SEEDED_AGENTS[1].owner,
    totalBudget: "1.45",
    nodeCount: 4,
    submittedAtBlock: 34890844,
    complete: false,
    hasReadableMetadata: true,
  },
  {
    id: "0xd003000000000000000000000000000000000000000000000000000000000003",
    title: "Dataset Labeling QA Pipeline",
    metadataURI: "0g://dags/dataset-labeling-qa-pipeline",
    owner: SEEDED_AGENTS[2].owner,
    totalBudget: "0.90",
    nodeCount: 3,
    submittedAtBlock: 34890192,
    complete: true,
    hasReadableMetadata: true,
  },
];

type SeedNode = LiveDAGNode & {
  startedOffset: number;
  deadlineBlocks: number;
};

const SEEDED_DAG_DETAILS: Record<string, { nodes: SeedNode[]; edges: [string, string][] }> = {
  [SEEDED_DAGS[0].id]: {
    nodes: [
      {
        id: "0xd001010000000000000000000000000000000000000000000000000000000001",
        label: "Source discovery",
        type: "SEQUENTIAL",
        status: "Settled",
        budget: 0.35,
        payout: 0.34,
        agentId: SEEDED_AGENTS[0].id,
        agentName: SEEDED_AGENTS[0].name,
        deps: [],
        score: 96,
        startedOffset: 0,
        deadlineBlocks: 7200,
      },
      {
        id: "0xd001020000000000000000000000000000000000000000000000000000000002",
        label: "Evidence synthesis",
        type: "SEQUENTIAL",
        status: "Executing",
        budget: 0.45,
        agentId: SEEDED_AGENTS[0].id,
        agentName: SEEDED_AGENTS[0].name,
        deps: ["0xd001010000000000000000000000000000000000000000000000000000000001"],
        startedOffset: 12,
        deadlineBlocks: 9600,
      },
      {
        id: "0xd001030000000000000000000000000000000000000000000000000000000003",
        label: "Executive brief",
        type: "REDUCE",
        status: "Pending",
        budget: 0.25,
        agentId: SEEDED_AGENTS[2].id,
        agentName: SEEDED_AGENTS[2].name,
        deps: ["0xd001020000000000000000000000000000000000000000000000000000000002"],
        startedOffset: 24,
        deadlineBlocks: 4800,
      },
    ],
    edges: [
      [
        "0xd001010000000000000000000000000000000000000000000000000000000001",
        "0xd001020000000000000000000000000000000000000000000000000000000002",
      ],
      [
        "0xd001020000000000000000000000000000000000000000000000000000000002",
        "0xd001030000000000000000000000000000000000000000000000000000000003",
      ],
    ],
  },
  [SEEDED_DAGS[1].id]: {
    nodes: [
      {
        id: "0xd002010000000000000000000000000000000000000000000000000000000001",
        label: "Threat model",
        type: "SEQUENTIAL",
        status: "Settled",
        budget: 0.3,
        payout: 0.29,
        agentId: SEEDED_AGENTS[1].id,
        agentName: SEEDED_AGENTS[1].name,
        deps: [],
        score: 94,
        startedOffset: 0,
        deadlineBlocks: 6400,
      },
      {
        id: "0xd002020000000000000000000000000000000000000000000000000000000002",
        label: "Code analysis",
        type: "PARALLEL",
        status: "AwaitingVerify",
        budget: 0.55,
        agentId: SEEDED_AGENTS[1].id,
        agentName: SEEDED_AGENTS[1].name,
        deps: ["0xd002010000000000000000000000000000000000000000000000000000000001"],
        startedOffset: 10,
        deadlineBlocks: 12800,
      },
      {
        id: "0xd002030000000000000000000000000000000000000000000000000000000003",
        label: "Test plan",
        type: "PARALLEL",
        status: "Executing",
        budget: 0.35,
        agentId: SEEDED_AGENTS[1].id,
        agentName: SEEDED_AGENTS[1].name,
        deps: ["0xd002010000000000000000000000000000000000000000000000000000000001"],
        startedOffset: 18,
        deadlineBlocks: 9600,
      },
      {
        id: "0xd002040000000000000000000000000000000000000000000000000000000004",
        label: "Audit report",
        type: "REDUCE",
        status: "Pending",
        budget: 0.25,
        agentId: SEEDED_AGENTS[2].id,
        agentName: SEEDED_AGENTS[2].name,
        deps: [
          "0xd002020000000000000000000000000000000000000000000000000000000002",
          "0xd002030000000000000000000000000000000000000000000000000000000003",
        ],
        startedOffset: 32,
        deadlineBlocks: 6400,
      },
    ],
    edges: [
      [
        "0xd002010000000000000000000000000000000000000000000000000000000001",
        "0xd002020000000000000000000000000000000000000000000000000000000002",
      ],
      [
        "0xd002010000000000000000000000000000000000000000000000000000000001",
        "0xd002030000000000000000000000000000000000000000000000000000000003",
      ],
      [
        "0xd002020000000000000000000000000000000000000000000000000000000002",
        "0xd002040000000000000000000000000000000000000000000000000000000004",
      ],
      [
        "0xd002030000000000000000000000000000000000000000000000000000000003",
        "0xd002040000000000000000000000000000000000000000000000000000000004",
      ],
    ],
  },
  [SEEDED_DAGS[2].id]: {
    nodes: [
      {
        id: "0xd003010000000000000000000000000000000000000000000000000000000001",
        label: "Schema inspection",
        type: "SEQUENTIAL",
        status: "Settled",
        budget: 0.2,
        payout: 0.2,
        agentId: SEEDED_AGENTS[0].id,
        agentName: SEEDED_AGENTS[0].name,
        deps: [],
        score: 93,
        startedOffset: 0,
        deadlineBlocks: 4800,
      },
      {
        id: "0xd003020000000000000000000000000000000000000000000000000000000002",
        label: "Sample audit",
        type: "PARALLEL",
        status: "Settled",
        budget: 0.45,
        payout: 0.43,
        agentId: SEEDED_AGENTS[2].id,
        agentName: SEEDED_AGENTS[2].name,
        deps: ["0xd003010000000000000000000000000000000000000000000000000000000001"],
        score: 95,
        startedOffset: 8,
        deadlineBlocks: 9600,
      },
      {
        id: "0xd003030000000000000000000000000000000000000000000000000000000003",
        label: "QA report",
        type: "REDUCE",
        status: "Settled",
        budget: 0.25,
        payout: 0.24,
        agentId: SEEDED_AGENTS[2].id,
        agentName: SEEDED_AGENTS[2].name,
        deps: ["0xd003020000000000000000000000000000000000000000000000000000000002"],
        score: 97,
        startedOffset: 18,
        deadlineBlocks: 6400,
      },
    ],
    edges: [
      [
        "0xd003010000000000000000000000000000000000000000000000000000000001",
        "0xd003020000000000000000000000000000000000000000000000000000000002",
      ],
      [
        "0xd003020000000000000000000000000000000000000000000000000000000002",
        "0xd003030000000000000000000000000000000000000000000000000000000003",
      ],
    ],
  },
};

const PROGRESS_SEQUENCE: LiveDAGNode["status"][] = [
  "Bidding",
  "Executing",
  "AwaitingVerify",
  "Settled",
];

export function getSeededDAGDetails(dagRoot: string) {
  const seed = SEEDED_DAG_DETAILS[dagRoot];
  if (!seed) return null;
  const tick = Math.floor(Date.now() / 15000);
  const nodes = seed.nodes.map((node) => {
    if (node.status === "Settled" || node.status === "Failed") return node;
    const idx = Math.max(0, Math.min(PROGRESS_SEQUENCE.length - 1, tick - node.startedOffset));
    const status = PROGRESS_SEQUENCE[idx];
    return {
      ...node,
      status,
      score: status === "Settled" ? 92 + ((tick + node.label.length) % 7) : node.score,
      payout: status === "Settled" ? Number((node.budget * 0.96).toFixed(3)) : node.payout,
    };
  });
  return { nodes, edges: seed.edges };
}
