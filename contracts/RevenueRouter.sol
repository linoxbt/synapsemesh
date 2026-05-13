// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RevenueRouter
 * @notice Splits incoming OG payments between: agent, stakers share, treasury.
 *         Called by MeshEscrow.release() on successful task verification.
 *
 * MAINNET DEPLOYMENT PARAMS:
 *   _treasury      : TREASURY_ADDRESS from .env
 *   _agentShare    : basis points for agent  (e.g. 8000 = 80%)
 *   _stakerShare   : basis points for stakers (e.g. 1000 = 10%)
 *   _treasuryShare : basis points for treasury (e.g. 1000 = 10%)
 *                    Must sum to 10000.
 *
 * DEPLOY ORDER: After MeshEscrow. Then call MeshEscrow.setRevenueRouter(thisAddress).
 */
contract RevenueRouter {

    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    address public treasury;
    address public meshEscrow;
    address public owner;

    uint256 public agentShare;    // basis points (out of 10000)
    uint256 public stakerShare;   // basis points
    uint256 public treasuryShare; // basis points

    // Staker rewards pool — simplified: accumulated per-agent staker reward
    mapping(address => uint256) public pendingStakerRewards; // agent => claimable OG
    mapping(address => uint256) public totalRouted;          // agent => lifetime OG routed

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event RevenueRouted(
        address indexed agent,
        uint256 agentAmount,
        uint256 stakerAmount,
        uint256 treasuryAmount
    );
    event StakerRewardClaimed(address indexed agent, uint256 amount);
    event SharesUpdated(uint256 agentShare, uint256 stakerShare, uint256 treasuryShare);

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyEscrow() {
        require(msg.sender == meshEscrow, "RevenueRouter: only MeshEscrow");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "RevenueRouter: not owner");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(
        address _treasury,
        uint256 _agentShare,
        uint256 _stakerShare,
        uint256 _treasuryShare
    ) {
        require(_treasury != address(0), "zero treasury");
        require(
            _agentShare + _stakerShare + _treasuryShare == 10000,
            "RevenueRouter: shares must sum to 10000"
        );

        treasury      = _treasury;
        agentShare    = _agentShare;
        stakerShare   = _stakerShare;
        treasuryShare = _treasuryShare;
        owner         = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────────

    function setMeshEscrow(address _meshEscrow) external onlyOwner {
        require(_meshEscrow != address(0), "zero escrow");
        meshEscrow = _meshEscrow;
    }

    function updateShares(
        uint256 _agentShare,
        uint256 _stakerShare,
        uint256 _treasuryShare
    ) external onlyOwner {
        require(
            _agentShare + _stakerShare + _treasuryShare == 10000,
            "RevenueRouter: must sum to 10000"
        );
        agentShare    = _agentShare;
        stakerShare   = _stakerShare;
        treasuryShare = _treasuryShare;
        emit SharesUpdated(_agentShare, _stakerShare, _treasuryShare);
    }

    function updateTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "zero treasury");
        treasury = _treasury;
    }

    // ─────────────────────────────────────────────────────────────
    //  Core routing — called by MeshEscrow with agent address encoded
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Routes payment. Called by MeshEscrow.release() via low-level call.
     * @param agent  The agent address that completed the task.
     */
    function route(address agent) external payable onlyEscrow {
        require(agent != address(0), "RevenueRouter: zero agent");
        require(msg.value > 0,       "RevenueRouter: zero value");

        uint256 total        = msg.value;
        uint256 agentAmt     = (total * agentShare)    / 10000;
        uint256 stakerAmt    = (total * stakerShare)   / 10000;
        uint256 treasuryAmt  = total - agentAmt - stakerAmt; // remainder to treasury

        // Pay agent directly
        payable(agent).transfer(agentAmt);

        // Accumulate staker rewards (claimed separately)
        pendingStakerRewards[agent] += stakerAmt;

        // Pay treasury
        payable(treasury).transfer(treasuryAmt);

        totalRouted[agent] += total;

        emit RevenueRouted(agent, agentAmt, stakerAmt, treasuryAmt);
    }

    /**
     * @notice Agents call this to claim accumulated staker rewards.
     *         In a full implementation this distributes pro-rata to stakers.
     *         For v1 it pays back to the agent as staking yield.
     */
    function claimStakerReward(address agent) external {
        require(msg.sender == agent, "RevenueRouter: only agent");
        uint256 reward = pendingStakerRewards[agent];
        require(reward > 0, "RevenueRouter: nothing to claim");
        pendingStakerRewards[agent] = 0;
        payable(agent).transfer(reward);
        emit StakerRewardClaimed(agent, reward);
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getPendingReward(address agent) external view returns (uint256) {
        return pendingStakerRewards[agent];
    }

    receive() external payable {}
}
