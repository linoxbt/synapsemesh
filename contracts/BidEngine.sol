// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;



interface IAgentRegistry {
function getReputation(address agent) external view returns (uint256);
function isRegistered(address agent) external view returns (bool);
}

interface IDAGRegistry {
function markNodeAssigned(bytes32 taskId, address agent) external;
function markNodeFailed(bytes32 taskId) external;
}

/**
 * @title BidEngine
 * @notice Reputation-weighted auction for DAG task nodes.
 *         Agents submit bids; the AUCTIONEER_ADDRESS calls awardBid.
 *
 * MAINNET DEPLOYMENT PARAMS:
 *   _agentRegistry : address of AgentRegistry
 *   _dagRegistry   : address of TaskDAGRegistry
 *   _auctioneer    : AUCTIONEER_ADDRESS from .env — TEE-managed key in production
 *
 * DEPLOY ORDER: After AgentRegistry and TaskDAGRegistry.
 */
contract BidEngine {

    // ─────────────────────────────────────────────────────────────
    //  Data structures
    // ─────────────────────────────────────────────────────────────

    struct Bid {
        address agent;
        uint256 price;       // OG wei the agent accepts
        uint256 eta;         // estimated blocks to complete
        uint256 reputation;  // snapshot at bid time
        uint256 submittedAt;
    }

    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    mapping(bytes32 => Bid[])   public bids;           // taskId => bids
    mapping(bytes32 => bool)    public awarded;         // taskId => already awarded
    mapping(bytes32 => address) public winner;          // taskId => winning agent

    address public agentRegistry;
    address public dagRegistry;
    address public auctioneer;   // AUCTIONEER_ADDRESS — only address that can call awardBid
    address public owner;

    uint256 public BID_WINDOW = 20; // blocks agents have to bid after node opens

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event BidSubmitted(bytes32 indexed taskId, address agent, uint256 price, uint256 eta);
    event BidAwarded(bytes32 indexed taskId, address winner, uint256 price);
    event NodeFailed(bytes32 indexed taskId, string reason);

    // ─────────────────────────────────────────────────────────────
    //  Interfaces
    // ─────────────────────────────────────────────────────────────





    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyAuctioneer() {
        require(msg.sender == auctioneer, "BidEngine: only auctioneer");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "BidEngine: not owner");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(
        address _agentRegistry,
        address _dagRegistry,
        address _auctioneer
    ) {
        require(_agentRegistry != address(0), "zero agentRegistry");
        require(_dagRegistry   != address(0), "zero dagRegistry");
        require(_auctioneer    != address(0), "zero auctioneer");

        agentRegistry = _agentRegistry;
        dagRegistry   = _dagRegistry;
        auctioneer    = _auctioneer;
        owner         = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    //  Bidding
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Submit a bid for a task node.
     * @param taskId  bytes32 task identifier from TaskDAGRegistry
     * @param price   OG wei the agent will accept for this task
     * @param eta     how many blocks the agent estimates to complete
     */
    function submitBid(
        bytes32 taskId,
        uint256 price,
        uint256 eta
    ) external {
        IAgentRegistry reg = IAgentRegistry(agentRegistry);
        require(reg.isRegistered(msg.sender), "BidEngine: agent not registered");
        require(!awarded[taskId],             "BidEngine: already awarded");

        uint256 rep = reg.getReputation(msg.sender);

        bids[taskId].push(Bid({
            agent:       msg.sender,
            price:       price,
            eta:         eta,
            reputation:  rep,
            submittedAt: block.number
        }));

        emit BidSubmitted(taskId, msg.sender, price, eta);
    }

    /**
     * @notice Award a bid to the selected agent. Called by the auctioneer
     *         (TEE-managed key). The auctioneer runs the scoring off-chain
     *         and submits the winner address.
     *
     *         Scoring formula (off-chain): score = (rep * 0.5) + (1/price * 0.3) + (1/eta * 0.2)
     *
     * @param taskId        bytes32 task identifier
     * @param winnerAgent   address of winning agent
     */
    function awardBid(bytes32 taskId, address winnerAgent) external onlyAuctioneer {
        require(!awarded[taskId], "BidEngine: already awarded");
        require(_hasBid(taskId, winnerAgent), "BidEngine: winner has no bid");

        awarded[taskId]  = true;
        winner[taskId]   = winnerAgent;

        IDAGRegistry(dagRegistry).markNodeAssigned(taskId, winnerAgent);

        // find the winning bid price for event
        uint256 price;
        Bid[] memory nodeBids = bids[taskId];
        for (uint256 i = 0; i < nodeBids.length; i++) {
            if (nodeBids[i].agent == winnerAgent) {
                price = nodeBids[i].price;
                break;
            }
        }

        emit BidAwarded(taskId, winnerAgent, price);
    }

    /**
     * @notice Mark a node as failed (no valid bids / timeout).
     *         Called by auctioneer.
     */
    function failNode(bytes32 taskId, string calldata reason) external onlyAuctioneer {
        require(!awarded[taskId], "BidEngine: already awarded");
        IDAGRegistry(dagRegistry).markNodeFailed(taskId);
        emit NodeFailed(taskId, reason);
    }

    // ─────────────────────────────────────────────────────────────
    //  Internal
    // ─────────────────────────────────────────────────────────────

    function _hasBid(bytes32 taskId, address agent) internal view returns (bool) {
        Bid[] memory nodeBids = bids[taskId];
        for (uint256 i = 0; i < nodeBids.length; i++) {
            if (nodeBids[i].agent == agent) return true;
        }
        return false;
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getBids(bytes32 taskId) external view returns (Bid[] memory) {
        return bids[taskId];
    }

    function getBidCount(bytes32 taskId) external view returns (uint256) {
        return bids[taskId].length;
    }

    function getWinner(bytes32 taskId) external view returns (address) {
        return winner[taskId];
    }
}
