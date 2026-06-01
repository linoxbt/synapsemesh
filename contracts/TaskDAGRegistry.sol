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

    struct DAGMetadata {
        string title;        // human-readable DAG title for explorers and dashboards
        string metadataURI;  // optional 0G Storage / HTTPS pointer to full spec
    }

    struct NodeMetadata {
        string label;             // human-readable node label
        string inputSchemaURI;    // optional 0G Storage / HTTPS pointer
        string outputSchemaURI;   // optional 0G Storage / HTTPS pointer
        string qualityRubricURI;  // optional 0G Storage / HTTPS pointer
    }

    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    mapping(bytes32 => DAG)          public dags;
    mapping(bytes32 => TaskNode)     public nodes;
    mapping(bytes32 => bytes32[])    public dagNodes;   // dagRoot => taskId[]
    mapping(bytes32 => bytes32)      public nodeToDag;   // taskId => dagRoot
    mapping(bytes32 => DAGMetadata)  public dagMetadata;
    mapping(bytes32 => NodeMetadata) public nodeMetadata;

    address public bidEngine;
    address public teeVerifier;
    address public meshEscrow;
    address public owner;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event DAGSubmitted(bytes32 indexed dagRoot, address requester, uint256 nodeCount, uint256 budget);
    event DAGMetadataSubmitted(bytes32 indexed dagRoot, string title, string metadataURI);
    event NodeMetadataSubmitted(
        bytes32 indexed dagRoot,
        bytes32 indexed taskId,
        string label,
        string inputSchemaURI,
        string outputSchemaURI,
        string qualityRubricURI
    );
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
        _submitDAG(dagRoot, taskNodes);
    }

    /**
     * @notice Submit a task DAG and publish UI/indexer metadata onchain.
     * @dev Hash commitments remain in TaskNode. URIs point to the full text on 0G Storage.
     */
    function submitDAGWithMetadata(
        bytes32 dagRoot,
        TaskNode[] calldata taskNodes,
        string calldata title,
        string calldata metadataURI,
        NodeMetadata[] calldata taskMetadata
    ) external payable {
        require(bytes(title).length > 0 && bytes(title).length <= 120, "DAGRegistry: bad title");
        require(bytes(metadataURI).length <= 180, "DAGRegistry: metadata too long");
        require(taskNodes.length == taskMetadata.length, "DAGRegistry: metadata length mismatch");

        _submitDAG(dagRoot, taskNodes);

        dagMetadata[dagRoot] = DAGMetadata({
            title: title,
            metadataURI: metadataURI
        });

        emit DAGMetadataSubmitted(dagRoot, title, metadataURI);

        for (uint256 i = 0; i < taskNodes.length; i++) {
            _validateNodeMetadata(taskMetadata[i]);
            bytes32 taskId = taskNodes[i].taskId;
            nodeMetadata[taskId] = taskMetadata[i];
            emit NodeMetadataSubmitted(
                dagRoot,
                taskId,
                taskMetadata[i].label,
                taskMetadata[i].inputSchemaURI,
                taskMetadata[i].outputSchemaURI,
                taskMetadata[i].qualityRubricURI
            );
        }
    }

    function _submitDAG(
        bytes32          dagRoot,
        TaskNode[] calldata taskNodes
    ) internal {
        require(dagRoot != bytes32(0), "DAGRegistry: zero dagRoot");
        require(dags[dagRoot].requester == address(0), "DAGRegistry: DAG already exists");
        require(taskNodes.length > 0,                  "DAGRegistry: empty DAG");

        _validateNoCycles(taskNodes);

        // Calculate total budget
        uint256 total = 0;
        bytes32[] memory taskIds = new bytes32[](taskNodes.length);
        uint256[] memory budgets = new uint256[](taskNodes.length);

        for (uint256 i = 0; i < taskNodes.length; i++) {
            require(taskNodes[i].taskId != bytes32(0), "DAGRegistry: zero taskId");
            require(nodeToDag[taskNodes[i].taskId] == bytes32(0), "DAGRegistry: duplicate taskId");
            require(taskNodes[i].maxBudget > 0, "DAGRegistry: zero budget");
            require(taskNodes[i].timeoutBlocks > 0, "DAGRegistry: zero timeout");
            total      += taskNodes[i].maxBudget;
            taskIds[i]  = taskNodes[i].taskId;
            budgets[i]  = taskNodes[i].maxBudget;
        }

        require(msg.value == total, "DAGRegistry: budget mismatch");

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
            bytes32 taskId = taskNodes[i].taskId;
            nodes[taskId] = taskNodes[i];
            if (taskNodes[i].dependsOn.length == 0) {
                if (taskNodes[i].assignedAgent != address(0)) {
                    nodes[taskId].status     = NodeStatus.ASSIGNED;
                    nodes[taskId].assignedAt = block.number;
                } else {
                    nodes[taskId].status = NodeStatus.BIDDING;
                }
            } else {
                nodes[taskId].status = NodeStatus.PENDING;
            }
            nodeToDag[taskId] = dagRoot;
            dagNodes[dagRoot].push(taskNodes[i].taskId);
            emit NodeStatusChanged(taskId, nodes[taskId].status, nodes[taskId].assignedAgent);
        }

        // Lock funds in escrow
        IMeshEscrow(meshEscrow).lockFunds{value: msg.value}(
            dagRoot, taskIds, budgets, msg.sender
        );

        emit DAGSubmitted(dagRoot, msg.sender, taskNodes.length, msg.value);
    }

    function _validateNodeMetadata(NodeMetadata calldata metadata) internal pure {
        require(bytes(metadata.label).length > 0 && bytes(metadata.label).length <= 80, "DAGRegistry: bad label");
        require(bytes(metadata.inputSchemaURI).length <= 180, "DAGRegistry: input URI too long");
        require(bytes(metadata.outputSchemaURI).length <= 180, "DAGRegistry: output URI too long");
        require(bytes(metadata.qualityRubricURI).length <= 180, "DAGRegistry: rubric URI too long");
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
        TaskNode storage n = nodes[taskId];
        require(
            n.status == NodeStatus.BIDDING || n.status == NodeStatus.PENDING,
            "DAGRegistry: node not fail-ready"
        );
        n.status = NodeStatus.FAILED;
        emit NodeStatusChanged(taskId, NodeStatus.FAILED, address(0));
        IMeshEscrow(meshEscrow).refundOnTimeout(taskId);
    }

    /// @notice Called by TEEVerifierBridge when work passes verification
    function markNodeComplete(bytes32 taskId) external onlyTEE {
        TaskNode storage n = nodes[taskId];
        require(
            n.status == NodeStatus.ASSIGNED || n.status == NodeStatus.RUNNING,
            "DAGRegistry: node not active"
        );
        n.status      = NodeStatus.COMPLETE;
        n.completedAt = block.number;
        emit NodeStatusChanged(taskId, NodeStatus.COMPLETE, n.assignedAgent);

        bytes32 dagRoot = nodeToDag[taskId];
        _openReadyDependents(dagRoot);
        _maybeMarkDAGComplete(dagRoot);
    }

    /// @notice Called by TEEVerifierBridge when verification fails
    function markNodeFailedByTEE(bytes32 taskId) external onlyTEE {
        TaskNode storage n = nodes[taskId];
        require(
            n.status == NodeStatus.ASSIGNED || n.status == NodeStatus.RUNNING,
            "DAGRegistry: node not active"
        );
        n.status = NodeStatus.FAILED;
        emit NodeStatusChanged(taskId, NodeStatus.FAILED, n.assignedAgent);
        IMeshEscrow(meshEscrow).refundOnTimeout(taskId);
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

    function _openReadyDependents(bytes32 dagRoot) internal {
        bytes32[] storage ids = dagNodes[dagRoot];
        for (uint256 i = 0; i < ids.length; i++) {
            TaskNode storage n = nodes[ids[i]];
            if (n.status == NodeStatus.PENDING && dependenciesMet(ids[i])) {
                if (n.assignedAgent != address(0)) {
                    n.status     = NodeStatus.ASSIGNED;
                    n.assignedAt = block.number;
                } else {
                    n.status = NodeStatus.BIDDING;
                }
                emit NodeStatusChanged(ids[i], n.status, n.assignedAgent);
            }
        }
    }

    function _maybeMarkDAGComplete(bytes32 dagRoot) internal {
        DAG storage d = dags[dagRoot];
        if (d.complete) return;

        bytes32[] storage ids = dagNodes[dagRoot];
        for (uint256 i = 0; i < ids.length; i++) {
            if (nodes[ids[i]].status != NodeStatus.COMPLETE) return;
        }

        d.complete = true;
        emit DAGCompleted(dagRoot);
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

    function getAssignedAgent(bytes32 taskId) external view returns (address) {
        return nodes[taskId].assignedAgent;
    }

    function dependenciesMet(bytes32 taskId) public view returns (bool) {
        bytes32[] memory deps = nodes[taskId].dependsOn;
        for (uint256 i = 0; i < deps.length; i++) {
            if (nodes[deps[i]].status != NodeStatus.COMPLETE) return false;
        }
        return true;
    }
}
