// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MeshEscrow
 * @notice Holds OG tokens for each DAG task node. Releases to the agent on
 *         TEE approval, or refunds to requester on timeout/failure.
 *
 * MAINNET DEPLOYMENT PARAMS:
 *   _dagRegistry  : address of TaskDAGRegistry
 *   _teeVerifier  : address of TEEVerifierBridge
 *   _revenueRouter: address of RevenueRouter
 *
 * DEPLOY ORDER: Deploy MeshEscrow BEFORE AgentRegistry (AgentRegistry needs escrow address).
 * Then after deploying RevenueRouter and TEEVerifierBridge, call:
 *   setRevenueRouter(revenueRouterAddress)
 *   setTeeVerifier(teeVerifierAddress)
 *   setDagRegistry(dagRegistryAddress)
 */
contract MeshEscrow {

    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    mapping(bytes32 => uint256) public nodeBudgets;    // taskId => OG locked (wei)
    mapping(bytes32 => bool)    public released;        // taskId => already settled
    mapping(bytes32 => address) public taskRequester;   // taskId => who to refund

    address public dagRegistry;
    address public teeVerifier;
    address public revenueRouter;
    address public owner;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event FundsLocked(bytes32 indexed dagRoot, uint256 totalAmount);
    event NodeReleased(bytes32 indexed taskId, address agent, uint256 amount);
    event NodeRefunded(bytes32 indexed taskId, address requester, uint256 amount);
    event AddressUpdated(string slot, address newAddress);

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyDAG() {
        require(msg.sender == dagRegistry, "MeshEscrow: only DAGRegistry");
        _;
    }

    modifier onlyTEE() {
        require(msg.sender == teeVerifier, "MeshEscrow: only TEEVerifier");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "MeshEscrow: not owner");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    //  Admin setters (called after dependent contracts deploy)
    // ─────────────────────────────────────────────────────────────

    function setDagRegistry(address _dagRegistry) external onlyOwner {
        require(_dagRegistry != address(0), "zero address");
        dagRegistry = _dagRegistry;
        emit AddressUpdated("dagRegistry", _dagRegistry);
    }

    function setTeeVerifier(address _teeVerifier) external onlyOwner {
        require(_teeVerifier != address(0), "zero address");
        teeVerifier = _teeVerifier;
        emit AddressUpdated("teeVerifier", _teeVerifier);
    }

    function setRevenueRouter(address _revenueRouter) external onlyOwner {
        require(_revenueRouter != address(0), "zero address");
        revenueRouter = _revenueRouter;
        emit AddressUpdated("revenueRouter", _revenueRouter);
    }

    // ─────────────────────────────────────────────────────────────
    //  Core logic
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Called by TaskDAGRegistry when a DAG is submitted.
     *         Locks OG per task node. msg.value must equal sum of budgets.
     */
    function lockFunds(
        bytes32          dagRoot,
        bytes32[] calldata taskIds,
        uint256[] calldata budgets,
        address          requester
    ) external payable onlyDAG {
        require(taskIds.length == budgets.length, "MeshEscrow: length mismatch");

        uint256 total = 0;
        for (uint256 i = 0; i < taskIds.length; i++) {
            nodeBudgets[taskIds[i]]  = budgets[i];
            taskRequester[taskIds[i]] = requester;
            total += budgets[i];
        }
        require(msg.value >= total, "MeshEscrow: insufficient funds");

        emit FundsLocked(dagRoot, total);
    }

    /**
     * @notice Called by TEEVerifierBridge when work passes. Sends payment
     *         to RevenueRouter which splits it between agent/stakers/treasury.
     */
    function release(bytes32 taskId, address agent) external onlyTEE {
        require(!released[taskId], "MeshEscrow: already settled");
        released[taskId] = true;

        uint256 amount = nodeBudgets[taskId];
        require(amount > 0, "MeshEscrow: zero budget");

        // Send to RevenueRouter for splitting, forward agent address
        (bool ok, ) = revenueRouter.call{value: amount}(
            abi.encodeWithSignature("route(address)", agent)
        );
        require(ok, "MeshEscrow: revenue router call failed");

        emit NodeReleased(taskId, agent, amount);
    }

    /**
     * @notice Called by TaskDAGRegistry on timeout. Refunds requester.
     */
    function refundOnTimeout(bytes32 taskId) external onlyDAG {
        require(!released[taskId], "MeshEscrow: already settled");
        released[taskId] = true;

        uint256 amount  = nodeBudgets[taskId];
        address requester = taskRequester[taskId];
        require(amount > 0,            "MeshEscrow: zero budget");
        require(requester != address(0), "MeshEscrow: unknown requester");

        payable(requester).transfer(amount);
        emit NodeRefunded(taskId, requester, amount);
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getBudget(bytes32 taskId) external view returns (uint256) {
        return nodeBudgets[taskId];
    }

    function isReleased(bytes32 taskId) external view returns (bool) {
        return released[taskId];
    }

    receive() external payable {}
}
