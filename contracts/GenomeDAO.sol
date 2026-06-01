// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;



interface IModelGenome {
function getSpeciesPopulation(bytes32 speciesId) external view returns (uint256[] memory);
function isActive(uint256 genomeId) external view returns (bool);
function ownerOf(uint256 tokenId) external view returns (address);
function setThresholds(uint8 extinction, uint8 deployment) external;
function EXTINCTION_THRESHOLD() external view returns (uint8);
function DEPLOYMENT_THRESHOLD() external view returns (uint8);
}

interface IEvolutionClock {
function setEpochLength(uint256 newLen) external;
}

interface IGenOps {
function setMutationRate(uint256 rate) external;
}

interface IAgentRegistry {
function setMinStake(uint256 minStake) external;
}

/**
 * @title GenomeDAO
 * @notice Governance contract. Genome NFT holders vote on evolution parameters:
 *         mutation rate, epoch length, extinction threshold, deployment threshold.
 *         Voting power = number of ACTIVE genomes owned.
 *
 * MAINNET DEPLOYMENT PARAMS:
 *   _genome      : address of ModelGenome
 *   _evoClock    : address of EvolutionClock
 *   _genOps      : address of GenOps
 *   _votingPeriod: blocks proposals stay open (e.g. 1000 blocks ≈ ~17 min on 0G)
 *   _quorum      : minimum votes to pass a proposal (e.g. 3)
 *
 * DEPLOY ORDER: Last — after all other contracts.
 */
contract GenomeDAO {

    // ─────────────────────────────────────────────────────────────
    //  Enums
    // ─────────────────────────────────────────────────────────────

    enum ProposalType {
        SET_MUTATION_RATE,        // GenOps.setMutationRate()
        SET_EPOCH_LENGTH,         // EvolutionClock.setEpochLength()
        SET_EXTINCTION_THRESHOLD, // ModelGenome.setThresholds()
        SET_DEPLOYMENT_THRESHOLD, // ModelGenome.setThresholds()
        SET_MIN_STAKE,            // AgentRegistry.setMinStake()
        CUSTOM                    // arbitrary encoded call — owner only
    }

    enum ProposalStatus { ACTIVE, PASSED, FAILED, EXECUTED }

    // ─────────────────────────────────────────────────────────────
    //  Data structures
    // ─────────────────────────────────────────────────────────────

    struct Proposal {
        uint256      id;
        address      proposer;
        ProposalType pType;
        uint256      value;        // new value to set
        string       description;
        uint256      forVotes;
        uint256      againstVotes;
        uint256      startBlock;
        uint256      endBlock;
        ProposalStatus status;
        bool         executed;
    }

    // ─────────────────────────────────────────────────────────────
    //  Interfaces
    // ─────────────────────────────────────────────────────────────







    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    mapping(uint256 => Proposal)                  public proposals;
    mapping(uint256 => mapping(address => bool))  public hasVoted;   // proposalId => voter => voted

    address public genome;
    address public evoClock;
    address public genOps;
    address public agentRegistry;
    address public owner;

    uint256 public proposalCount;
    uint256 public votingPeriod;  // blocks
    uint256 public quorum;        // minimum for-votes to pass

    // Species IDs for vote weight calculation
    bytes32[] public registeredSpecies;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event ProposalCreated(uint256 indexed id, address proposer, ProposalType pType, uint256 value);
    event VoteCast(uint256 indexed proposalId, address voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed id, bool passed);
    event QuorumUpdated(uint256 newQuorum);
    event VotingPeriodUpdated(uint256 newPeriod);
    event AgentRegistryUpdated(address agentRegistry);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "GenomeDAO: not owner");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(
        address _genome,
        address _evoClock,
        address _genOps,
        address _agentRegistry,
        uint256 _votingPeriod,
        uint256 _quorum
    ) {
        require(_genome   != address(0), "zero genome");
        require(_evoClock != address(0), "zero evoClock");
        require(_genOps   != address(0), "zero genOps");
        require(_votingPeriod > 0,       "zero voting period");
        require(_quorum > 0,             "zero quorum");

        genome        = _genome;
        evoClock      = _evoClock;
        genOps        = _genOps;
        agentRegistry = _agentRegistry;
        votingPeriod  = _votingPeriod;
        quorum        = _quorum;
        owner         = msg.sender;

        // Register default species IDs
        registeredSpecies.push(keccak256("writing"));
        registeredSpecies.push(keccak256("code"));
        registeredSpecies.push(keccak256("reasoning"));
        registeredSpecies.push(keccak256("creative"));
    }

    // ─────────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────────

    function setQuorum(uint256 _quorum) external onlyOwner {
        require(_quorum > 0, "GenomeDAO: zero quorum");
        quorum = _quorum;
        emit QuorumUpdated(_quorum);
    }

    function setVotingPeriod(uint256 _period) external onlyOwner {
        require(_period > 0, "GenomeDAO: zero period");
        votingPeriod = _period;
        emit VotingPeriodUpdated(_period);
    }

    function addSpecies(bytes32 speciesId) external onlyOwner {
        registeredSpecies.push(speciesId);
    }

    function setAgentRegistry(address _agentRegistry) external onlyOwner {
        require(_agentRegistry != address(0), "GenomeDAO: zero agentRegistry");
        agentRegistry = _agentRegistry;
        emit AgentRegistryUpdated(_agentRegistry);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "GenomeDAO: zero owner");
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    // ─────────────────────────────────────────────────────────────
    //  Governance
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Create a governance proposal.
     *         Proposer must own at least 1 active genome NFT.
     *
     * @param pType       Type of parameter to change
     * @param value       New value to set
     * @param description Human-readable description of the proposal
     */
    function propose(
        ProposalType pType,
        uint256      value,
        string calldata description
    ) external returns (uint256) {
        require(_votingPower(msg.sender) > 0, "GenomeDAO: no voting power");
        _validateProposal(pType, value);

        uint256 id = ++proposalCount;

        proposals[id] = Proposal({
            id:           id,
            proposer:     msg.sender,
            pType:        pType,
            value:        value,
            description:  description,
            forVotes:     0,
            againstVotes: 0,
            startBlock:   block.number,
            endBlock:     block.number + votingPeriod,
            status:       ProposalStatus.ACTIVE,
            executed:     false
        });

        emit ProposalCreated(id, msg.sender, pType, value);
        return id;
    }

    /**
     * @notice Cast a vote on a proposal.
     *         Voting power = number of active genome NFTs owned by caller.
     *
     * @param proposalId  Proposal to vote on
     * @param support     true = for, false = against
     */
    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(p.status == ProposalStatus.ACTIVE, "GenomeDAO: not active");
        require(block.number <= p.endBlock,         "GenomeDAO: voting ended");
        require(!hasVoted[proposalId][msg.sender],  "GenomeDAO: already voted");

        uint256 weight = _votingPower(msg.sender);
        require(weight > 0, "GenomeDAO: no voting power");

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            p.forVotes += weight;
        } else {
            p.againstVotes += weight;
        }

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    /**
     * @notice Execute a passed proposal after voting ends.
     *         Anyone can call this once voting period is over.
     */
    function execute(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(!p.executed,                        "GenomeDAO: already executed");
        require(block.number > p.endBlock,           "GenomeDAO: voting not ended");
        require(p.status == ProposalStatus.ACTIVE,  "GenomeDAO: not active");

        p.executed = true;

        bool passed = p.forVotes >= quorum && p.forVotes > p.againstVotes;

        if (passed) {
            _executeProposal(p);
            p.status = ProposalStatus.EXECUTED;
        } else {
            p.status = ProposalStatus.FAILED;
        }

        emit ProposalExecuted(proposalId, passed);
    }

    // ─────────────────────────────────────────────────────────────
    //  Internal
    // ─────────────────────────────────────────────────────────────

    function _executeProposal(Proposal storage p) internal {
        if (p.pType == ProposalType.SET_MUTATION_RATE) {
            IGenOps(genOps).setMutationRate(p.value);

        } else if (p.pType == ProposalType.SET_EPOCH_LENGTH) {
            IEvolutionClock(evoClock).setEpochLength(p.value);

        } else if (p.pType == ProposalType.SET_EXTINCTION_THRESHOLD) {
            uint8 deployment = IModelGenome(genome).DEPLOYMENT_THRESHOLD();
            IModelGenome(genome).setThresholds(uint8(p.value), deployment);

        } else if (p.pType == ProposalType.SET_DEPLOYMENT_THRESHOLD) {
            uint8 extinction = IModelGenome(genome).EXTINCTION_THRESHOLD();
            IModelGenome(genome).setThresholds(extinction, uint8(p.value));

        } else if (p.pType == ProposalType.SET_MIN_STAKE) {
            require(agentRegistry != address(0), "GenomeDAO: agent registry unset");
            IAgentRegistry(agentRegistry).setMinStake(p.value);
        }
        // CUSTOM is intentionally disabled until arbitrary-call governance is implemented.
    }

    function _validateProposal(ProposalType pType, uint256 value) internal view {
        require(pType != ProposalType.CUSTOM, "GenomeDAO: custom disabled");

        if (pType == ProposalType.SET_MUTATION_RATE) {
            require(value <= 10000, "GenomeDAO: mutation > 100%");

        } else if (pType == ProposalType.SET_EPOCH_LENGTH) {
            require(value > 0, "GenomeDAO: zero epoch length");

        } else if (pType == ProposalType.SET_EXTINCTION_THRESHOLD) {
            uint8 deployment = IModelGenome(genome).DEPLOYMENT_THRESHOLD();
            require(value < deployment, "GenomeDAO: extinction >= deployment");
            require(value <= 100, "GenomeDAO: threshold > 100");

        } else if (pType == ProposalType.SET_DEPLOYMENT_THRESHOLD) {
            uint8 extinction = IModelGenome(genome).EXTINCTION_THRESHOLD();
            require(value > extinction, "GenomeDAO: deployment <= extinction");
            require(value <= 100, "GenomeDAO: threshold > 100");

        } else if (pType == ProposalType.SET_MIN_STAKE) {
            require(agentRegistry != address(0), "GenomeDAO: agent registry unset");
            require(value > 0, "GenomeDAO: zero min stake");
        }
    }

    /**
     * @notice Voting power = count of active genome NFTs owned.
     */
    function _votingPower(address voter) internal view returns (uint256 power) {
        IModelGenome g = IModelGenome(genome);
        for (uint256 s = 0; s < registeredSpecies.length; s++) {
            // Note: getSpeciesPopulation is expensive on-chain for large populations.
            // For production consider an off-chain snapshot + merkle proof approach.
            uint256[] memory pop = g.getSpeciesPopulation(registeredSpecies[s]);
            for (uint256 i = 0; i < pop.length; i++) {
                if (g.ownerOf(pop[i]) == voter && g.isActive(pop[i])) {
                    power++;
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getProposal(uint256 id) external view returns (Proposal memory) {
        return proposals[id];
    }

    function getVotingPower(address voter) external view returns (uint256) {
        return _votingPower(voter);
    }

    function isVotingOpen(uint256 proposalId) external view returns (bool) {
        Proposal memory p = proposals[proposalId];
        return p.status == ProposalStatus.ACTIVE && block.number <= p.endBlock;
    }
}
