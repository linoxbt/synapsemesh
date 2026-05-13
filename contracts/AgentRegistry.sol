// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentRegistry
 * @notice Registers AI agents on SynapseMesh. Agents stake OG tokens to participate,
 *         earn reputation by completing tasks, and can be slashed for poor work.
 * @dev Deployed first. Address passed into AgentRegistry constructor.
 *
 * MAINNET DEPLOYMENT PARAMS:
 *   _meshEscrow     : address of MeshEscrow (deploy MeshEscrow first, paste address here)
 *   _teeVerifier    : address of TEEVerifierBridge (deploy after, then call setTeeVerifier)
 *   _treasury       : wallet that receives slashed stake (use TREASURY_ADDRESS from .env)
 *
 * POST-DEPLOY:
 *   Call setTeeVerifier(teeVerifierAddress) after TEEVerifierBridge is deployed.
 */
contract AgentRegistry {

    // ─────────────────────────────────────────────────────────────
    //  Data structures
    // ─────────────────────────────────────────────────────────────

    struct Agent {
        address owner;
        bytes32 agentId;          // keccak256 of agent's 0G Agent ID string
        uint256 stakedAmount;     // OG tokens locked (wei units)
        uint256 reputation;       // 0–1000 scale, starts at 500
        uint256 tasksCompleted;
        uint256 totalEarned;      // cumulative OG earned (informational)
        bool    slashed;          // ever slashed flag
        bool    active;           // false = withdrawn / deregistered
    }

    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    mapping(address => Agent)  public agents;
    mapping(address => bool)   public registered;
    mapping(bytes32 => address) public agentIdToOwner; // reverse lookup

    uint256 public MIN_STAKE   = 100 ether;  // 100 OG — governance can update
    address public meshEscrow;
    address public teeVerifier;
    address public treasury;
    address public owner;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event AgentRegistered(address indexed agent, bytes32 agentId, uint256 stake);
    event ReputationUpdated(address indexed agent, uint256 newScore);
    event AgentSlashed(address indexed agent, uint256 penalty);
    event AgentDeregistered(address indexed agent, uint256 stakeReturned);
    event MinStakeUpdated(uint256 newMin);
    event TeeVerifierSet(address teeVerifier);

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyAuthorized() {
        require(
            msg.sender == meshEscrow || msg.sender == teeVerifier,
            "AgentRegistry: unauthorized caller"
        );
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "AgentRegistry: not owner");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(
        address _meshEscrow,
        address _treasury
    ) {
        require(_meshEscrow != address(0), "zero escrow");
        require(_treasury   != address(0), "zero treasury");
        meshEscrow = _meshEscrow;
        treasury   = _treasury;
        owner      = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────────

    /// @notice Call this after TEEVerifierBridge is deployed
    function setTeeVerifier(address _teeVerifier) external onlyOwner {
        require(_teeVerifier != address(0), "zero verifier");
        teeVerifier = _teeVerifier;
        emit TeeVerifierSet(_teeVerifier);
    }

    function setMinStake(uint256 _min) external onlyOwner {
        MIN_STAKE = _min;
        emit MinStakeUpdated(_min);
    }

    // ─────────────────────────────────────────────────────────────
    //  Registration
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Register as an agent. Must send >= MIN_STAKE OG.
     * @param _agentId  keccak256 hash of your 0G Agent ID string
     */
    function register(bytes32 _agentId) external payable {
        require(!registered[msg.sender],          "AgentRegistry: already registered");
        require(msg.value >= MIN_STAKE,            "AgentRegistry: stake too low");
        require(agentIdToOwner[_agentId] == address(0), "AgentRegistry: agentId taken");

        agents[msg.sender] = Agent({
            owner:          msg.sender,
            agentId:        _agentId,
            stakedAmount:   msg.value,
            reputation:     500,
            tasksCompleted: 0,
            totalEarned:    0,
            slashed:        false,
            active:         true
        });

        registered[msg.sender]       = true;
        agentIdToOwner[_agentId]     = msg.sender;

        emit AgentRegistered(msg.sender, _agentId, msg.value);
    }

    /**
     * @notice Deregister and withdraw stake. Only callable when not assigned to any task.
     */
    function deregister() external {
        require(registered[msg.sender],         "AgentRegistry: not registered");
        require(agents[msg.sender].active,      "AgentRegistry: already inactive");

        Agent storage a = agents[msg.sender];
        uint256 refund  = a.stakedAmount;
        a.stakedAmount  = 0;
        a.active        = false;

        delete agentIdToOwner[a.agentId];
        registered[msg.sender] = false;

        payable(msg.sender).transfer(refund);
        emit AgentDeregistered(msg.sender, refund);
    }

    // ─────────────────────────────────────────────────────────────
    //  Reputation & slashing — called by TEEVerifierBridge
    // ─────────────────────────────────────────────────────────────

    function incrementReputation(address _agent, uint8 _score) external onlyAuthorized {
        Agent storage a = agents[_agent];
        uint256 boost = _score > 85 ? 10 : (_score > 70 ? 5 : 2);
        a.reputation = (a.reputation + boost > 1000) ? 1000 : a.reputation + boost;
        a.tasksCompleted++;
        emit ReputationUpdated(_agent, a.reputation);
    }

    function slash(address _agent) external onlyAuthorized {
        Agent storage a = agents[_agent];
        require(a.active, "AgentRegistry: agent not active");

        uint256 penalty = a.stakedAmount / 10; // 10% slash
        a.stakedAmount -= penalty;
        a.reputation    = a.reputation > 50 ? a.reputation - 50 : 0;
        a.slashed       = true;

        payable(treasury).transfer(penalty);
        emit AgentSlashed(_agent, penalty);
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getReputation(address _agent) external view returns (uint256) {
        return agents[_agent].reputation;
    }

    function getAgent(address _agent) external view returns (Agent memory) {
        return agents[_agent];
    }

    function isRegistered(address _agent) external view returns (bool) {
        return registered[_agent];
    }
}
