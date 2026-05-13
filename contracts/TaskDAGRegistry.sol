// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;



interface IMeshEscrow {
function lockFunds(
bytes32 dagRoot,
bytes32[] calldata taskIds,
uint256[] calldata budgets,
address requester
) external payable;
function refundOnTimeout(bytes32 taskId) external;
}

/**
 * @title TaskDAGRegistry
 * @notice Stores Task DAG structures on 0G Chain. Validates topology (no cycles),
 *         manages node state transitions, and triggers escrow on submission.
 *
 * MAINNET DEPLOYMENT PARAMS:
 *   _bidEngine   : address of BidEngine
 *   _teeVerifier : address of TEEVerifierBridge
 *   _meshEscrow  : address of MeshEscrow
 *
 * DEPLOY ORDER: After BidEngine and MeshEscrow. Before TEEVerifierBridge.
 * After deploying TEEVerifierBridge, call setTeeVerifier(teeVerifierAddress).
 */
contract TaskDAGRegistry {

    // ─────────────────────────────────────────────────────────────
    //  Enums
    // ─────────────────────────────────────────────────────────────

    enum NodeType   { SEQUENTIAL, PARALLEL, CONDITIONAL, REDUCE }
    enum NodeStatus { PENDING, BIDDING, ASSIGNED, RUNNING, COMPLETE, FAILED }

    // ─────────────────────────────────────────────────────────────
    //  Data structures
    // ─────────────────────────────────────────────────────────────

    struct TaskNode {
        bytes32    taskId;
        bytes32    inputSchemaHash;    // hash of full spec stored on 0G Storage
        bytes32    outputSchemaHash;
        bytes32    qualityRubricHash;  // TEE verifier reads rubric from 0G KV
        bytes32[]  dependsOn;          // upstream taskIds (must all be COMPLETE first)
        NodeType   nodeType;
        uint256    maxBudget;          // OG wei budget for this node
        uint256    timeoutBlocks;      // blocks before node can be marked failed
        address    assignedAgent;
        NodeStatus status;
        uint256    assignedAt;
        uint256    completedAt;
    }

    struct DAG {
        bytes32 dagRoot;
        address requester;
        uint256 totalBudget;
        uint256 submittedAt;
        uint256 nodeCount;
        bool    complete;
    }

    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    mapping(bytes32 => DAG)          public dags;
    mapping(bytes32 => TaskNode)     public nodes;
    mapping(bytes32 => bytes32[])    public dagNodes;   // dagRoot => taskId[]

    address public bidEngine;
    address public teeVerifier;
    address public meshEscrow;
    address public owner;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event DAGSubmitted(bytes32 indexed dagRoot, address requester, uint256 nodeCount, uint256 budget);
    event NodeStatusChanged(bytes32 indexed taskId, NodeStatus newStatus, address agent);
    event DAGCompleted(bytes32 indexed dagRoot);

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyBidEngine() {
        require(msg.sender == bidEngine, "DAGRegistry: only BidEngine");
        _;
    }

    modifier onlyTEE() {
        require(msg.sender == teeVerifier, "DAGRegistry: only TEEVerifier");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "DAGRegistry: not owner");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Interfaces
    // ─────────────────────────────────────────────────────────────



    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(
        address _bidEngine,
        address _meshEscrow
    ) {
        require(_bidEngine  != address(0), "zero bidEngine");
        require(_meshEscrow != address(0), "zero meshEscrow");
        bidEngine   = _bidEngine;
        meshEscrow  = _meshEscrow;
        owner       = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────────

    function setTeeVerifier(address _teeVerifier) external onlyOwner {
        require(_teeVerifier != address(0), "zero verifier");
        teeVerifier = _teeVerifier;
    }

    // ─────────────────────────────────────────────────────────────
    //  DAG submission
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Submit a task DAG. msg.value must equal the sum of all node maxBudgets.
     *         Nodes must be ordered so all dependsOn references appear earlier in the array.
     *
     * @param dagRoot   unique identifier for this DAG (keccak256 of requester+nonce)
     * @param taskNodes ordered array of task nodes
     */
    function submitDAG(
        bytes32          dagRoot,
        TaskNode[] calldata taskNodes
    ) external payable {
        require(dags[dagRoot].requester == address(0), "DAGRegistry: DAG already exists");
        require(taskNodes.length > 0,                  "DAGRegistry: empty DAG");

        _validateNoCycles(taskNodes);

        // Calculate total budget
        uint256 total = 0;
        bytes32[] memory taskIds = new bytes32[](taskNodes.length);
        uint256[] memory budgets = new uint256[](taskNodes.length);

        for (uint256 i = 0; i < taskNodes.length; i++) {
            total      += taskNodes[i].maxBudget;
            taskIds[i]  = taskNodes[i].taskId;
            budgets[i]  = taskNodes[i].maxBudget;
        }

        require(msg.value >= total, "DAGRegistry: insufficient budget");

        // Store DAG metadata
        dags[dagRoot] = DAG({
            dagRoot:     dagRoot,
            requester:   msg.sender,
            totalBudget: msg.value,
            submittedAt: block.number,
            nodeCount:   taskNodes.length,
            complete:    false
        });

        // Store nodes
        for (uint256 i = 0; i < taskNodes.length; i++) {
            nodes[taskNodes[i].taskId]        = taskNodes[i];
            nodes[taskNodes[i].taskId].status = NodeStatus.BIDDING;
            dagNodes[dagRoot].push(taskNodes[i].taskId);
        }

        // Lock funds in escrow
        IMeshEscrow(meshEscrow).lockFunds{value: msg.value}(
            dagRoot, taskIds, budgets, msg.sender
        );

        emit DAGSubmitted(dagRoot, msg.sender, taskNodes.length, msg.value);
    }

    // ─────────────────────────────────────────────────────────────
    //  Status transitions
    // ─────────────────────────────────────────────────────────────

    /// @notice Called by BidEngine when a bid is awarded
    function markNodeAssigned(bytes32 taskId, address agent) external onlyBidEngine {
        TaskNode storage n = nodes[taskId];
        require(n.status == NodeStatus.BIDDING, "DAGRegistry: not in BIDDING state");
        n.assignedAgent = agent;
        n.status        = NodeStatus.ASSIGNED;
        n.assignedAt    = block.number;
        emit NodeStatusChanged(taskId, NodeStatus.ASSIGNED, agent);
    }

    /// @notice Called by BidEngine when no bid awarded (fail)
    function markNodeFailed(bytes32 taskId) external onlyBidEngine {
        nodes[taskId].status = NodeStatus.FAILED;
        emit NodeStatusChanged(taskId, NodeStatus.FAILED, address(0));
        IMeshEscrow(meshEscrow).refundOnTimeout(taskId);
    }

    /// @notice Called by TEEVerifierBridge when work passes verification
    function markNodeComplete(bytes32 taskId) external onlyTEE {
        TaskNode storage n = nodes[taskId];
        n.status      = NodeStatus.COMPLETE;
        n.completedAt = block.number;
        emit NodeStatusChanged(taskId, NodeStatus.COMPLETE, n.assignedAgent);
    }

    /// @notice Anyone can trigger a timeout refund if timeoutBlocks has passed
    function triggerTimeout(bytes32 taskId) external {
        TaskNode storage n = nodes[taskId];
        require(
            n.status == NodeStatus.ASSIGNED || n.status == NodeStatus.RUNNING,
            "DAGRegistry: node not in active state"
        );
        require(
            block.number > n.assignedAt + n.timeoutBlocks,
            "DAGRegistry: timeout not reached"
        );
        n.status = NodeStatus.FAILED;
        emit NodeStatusChanged(taskId, NodeStatus.FAILED, n.assignedAgent);
        IMeshEscrow(meshEscrow).refundOnTimeout(taskId);
    }

    // ─────────────────────────────────────────────────────────────
    //  Cycle detection — Kahn's algorithm (topological sort check)
    // ─────────────────────────────────────────────────────────────

    function _validateNoCycles(TaskNode[] calldata ns) internal pure {
        for (uint256 i = 0; i < ns.length; i++) {
            for (uint256 j = 0; j < ns[i].dependsOn.length; j++) {
                bool found = false;
                for (uint256 k = 0; k < i; k++) {
                    if (ns[k].taskId == ns[i].dependsOn[j]) {
                        found = true;
                        break;
                    }
                }
                require(found, "DAGRegistry: cycle detected or bad dependency");
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getDAG(bytes32 dagRoot) external view returns (DAG memory) {
        return dags[dagRoot];
    }

    function getNode(bytes32 taskId) external view returns (TaskNode memory) {
        return nodes[taskId];
    }

    function getDAGNodes(bytes32 dagRoot) external view returns (bytes32[] memory) {
        return dagNodes[dagRoot];
    }

    function getNodeStatus(bytes32 taskId) external view returns (NodeStatus) {
        return nodes[taskId].status;
    }

    function dependenciesMet(bytes32 taskId) external view returns (bool) {
        bytes32[] memory deps = nodes[taskId].dependsOn;
        for (uint256 i = 0; i < deps.length; i++) {
            if (nodes[deps[i]].status != NodeStatus.COMPLETE) return false;
        }
        return true;
    }
}
