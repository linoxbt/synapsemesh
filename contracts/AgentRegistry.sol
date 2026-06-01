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

    struct AgentProfile {
        string name;               // human-readable market name
        string operation;          // Researcher, Writer, Verifier, etc.
        string endpoint;           // optional service endpoint
        string metadataURI;        // optional 0G Storage / HTTPS metadata pointer
    }

    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    mapping(address => Agent)  public agents;
    mapping(address => AgentProfile) public profiles;
    mapping(address => string[]) private profileCapabilities;
    mapping(address => bool)   public registered;
    mapping(bytes32 => address) public agentIdToOwner; // reverse lookup

    uint256 public MIN_STAKE   = 0.05 ether;  // governance can update
    address public meshEscrow;
    address public teeVerifier;
    address public treasury;
    address public owner;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event AgentRegistered(address indexed agent, bytes32 agentId, uint256 stake);
    event AgentProfileUpdated(
        address indexed agent,
        bytes32 indexed agentId,
        string name,
        string operation,
        string[] capabilities,
        string endpoint,
        string metadataURI
    );
    event ReputationUpdated(address indexed agent, uint256 newScore);
    event AgentSlashed(address indexed agent, uint256 penalty);
    event AgentDeregistered(address indexed agent, uint256 stakeReturned);
    event EarningsRecorded(address indexed agent, uint256 amount, uint256 totalEarned);
    event MinStakeUpdated(uint256 newMin);
    event TeeVerifierSet(address teeVerifier);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

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
        require(_min > 0, "AgentRegistry: zero min");
        MIN_STAKE = _min;
        emit MinStakeUpdated(_min);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "AgentRegistry: zero owner");
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    // ─────────────────────────────────────────────────────────────
    //  Registration
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Register as an agent. Must send >= MIN_STAKE OG.
     * @param _agentId  keccak256 hash of your 0G Agent ID string
     */
    function register(bytes32 _agentId) external payable {
        _register(msg.sender, _agentId, msg.value);
    }

    /**
     * @notice Register as an agent and publish market metadata onchain.
     * @dev The profile lives in contract storage and is also emitted for indexers.
     */
    function registerWithProfile(
        bytes32 _agentId,
        string calldata name,
        string calldata operation,
        string[] calldata capabilities,
        string calldata endpoint,
        string calldata metadataURI
    ) external payable {
        _register(msg.sender, _agentId, msg.value);
        _setProfile(msg.sender, _agentId, name, operation, capabilities, endpoint, metadataURI);
    }

    function updateProfile(
        string calldata name,
        string calldata operation,
        string[] calldata capabilities,
        string calldata endpoint,
        string calldata metadataURI
    ) external {
        require(registered[msg.sender] && agents[msg.sender].active, "AgentRegistry: agent not active");
        _setProfile(
            msg.sender,
            agents[msg.sender].agentId,
            name,
            operation,
            capabilities,
            endpoint,
            metadataURI
        );
    }

    function _register(address agent, bytes32 _agentId, uint256 stake) internal {
        require(!registered[agent],               "AgentRegistry: already registered");
        require(stake >= MIN_STAKE,                "AgentRegistry: stake too low");
        require(_agentId != bytes32(0),            "AgentRegistry: zero agentId");
        require(agentIdToOwner[_agentId] == address(0), "AgentRegistry: agentId taken");

        agents[agent] = Agent({
            owner:          agent,
            agentId:        _agentId,
            stakedAmount:   stake,
            reputation:     500,
            tasksCompleted: 0,
            totalEarned:    0,
            slashed:        false,
            active:         true
        });

        registered[agent]       = true;
        agentIdToOwner[_agentId] = agent;

        emit AgentRegistered(agent, _agentId, stake);
    }

    function _setProfile(
        address agent,
        bytes32 agentId,
        string calldata name,
        string calldata operation,
        string[] calldata capabilities,
        string calldata endpoint,
        string calldata metadataURI
    ) internal {
        _validateProfile(name, operation, capabilities, endpoint, metadataURI);

        profiles[agent] = AgentProfile({
            name: name,
            operation: operation,
            endpoint: endpoint,
            metadataURI: metadataURI
        });

        delete profileCapabilities[agent];
        for (uint256 i = 0; i < capabilities.length; i++) {
            profileCapabilities[agent].push(capabilities[i]);
        }

        emit AgentProfileUpdated(
            agent,
            agentId,
            name,
            operation,
            capabilities,
            endpoint,
            metadataURI
        );
    }

    function _validateProfile(
        string calldata name,
        string calldata operation,
        string[] calldata capabilities,
        string calldata endpoint,
        string calldata metadataURI
    ) internal pure {
        require(bytes(name).length > 0 && bytes(name).length <= 64, "AgentRegistry: bad name");
        require(
            bytes(operation).length > 0 && bytes(operation).length <= 32,
            "AgentRegistry: bad operation"
        );
        require(
            capabilities.length > 0 && capabilities.length <= 12,
            "AgentRegistry: bad capabilities"
        );
        require(bytes(endpoint).length <= 160, "AgentRegistry: endpoint too long");
        require(bytes(metadataURI).length <= 160, "AgentRegistry: metadata too long");

        for (uint256 i = 0; i < capabilities.length; i++) {
            require(
                bytes(capabilities[i]).length > 0 && bytes(capabilities[i]).length <= 40,
                "AgentRegistry: bad capability"
            );
        }
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

        _sendValue(msg.sender, refund);
        emit AgentDeregistered(msg.sender, refund);
    }

    // ─────────────────────────────────────────────────────────────
    //  Reputation & slashing — called by TEEVerifierBridge
    // ─────────────────────────────────────────────────────────────

    function incrementReputation(address _agent, uint8 _score) external onlyAuthorized {
        Agent storage a = agents[_agent];
        require(registered[_agent] && a.active, "AgentRegistry: agent not active");
        uint256 boost = _score > 85 ? 10 : (_score > 70 ? 5 : 2);
        a.reputation = (a.reputation + boost > 1000) ? 1000 : a.reputation + boost;
        a.tasksCompleted++;
        emit ReputationUpdated(_agent, a.reputation);
    }

    function slash(address _agent) external onlyAuthorized {
        Agent storage a = agents[_agent];
        require(registered[_agent] && a.active, "AgentRegistry: agent not active");

        uint256 penalty = a.stakedAmount / 10; // 10% slash
        a.stakedAmount -= penalty;
        a.reputation    = a.reputation > 50 ? a.reputation - 50 : 0;
        a.slashed       = true;

        _sendValue(treasury, penalty);
        emit AgentSlashed(_agent, penalty);
    }

    function recordEarnings(address _agent, uint256 amount) external onlyAuthorized {
        Agent storage a = agents[_agent];
        require(registered[_agent] && a.active, "AgentRegistry: agent not active");
        a.totalEarned += amount;
        emit EarningsRecorded(_agent, amount, a.totalEarned);
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

    function getAgentProfile(address _agent)
        external
        view
        returns (
            string memory name,
            string memory operation,
            string[] memory capabilities,
            string memory endpoint,
            string memory metadataURI
        )
    {
        AgentProfile storage p = profiles[_agent];
        return (
            p.name,
            p.operation,
            profileCapabilities[_agent],
            p.endpoint,
            p.metadataURI
        );
    }

    function isRegistered(address _agent) external view returns (bool) {
        return registered[_agent];
    }

    function _sendValue(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "AgentRegistry: transfer failed");
    }
}
