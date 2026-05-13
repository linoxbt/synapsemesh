// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// OpenZeppelin — install: npm install @openzeppelin/contracts
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ModelGenome
 * @notice ERC-7857 Intelligent NFT. Every AI model in the Evolution Lab
 *         is represented as a genome NFT with encrypted adapter weights
 *         stored on 0G Storage. Fitness scoring drives extinction or deployment.
 *
 * MAINNET DEPLOYMENT PARAMS:
 *   _fitnessOracle : address of FitnessOracle
 *   _genOps        : address of GenOps
 *   _treasury      : TREASURY_ADDRESS (receives mint fees)
 *
 * DEPLOY ORDER: After FitnessOracle and GenOps are deployed.
 *               FitnessOracle and GenOps are deployed with address(0) for genome,
 *               then updated via their setGenome() functions after this deploys.
 */
contract ModelGenome is ERC721, Ownable {

    // ─────────────────────────────────────────────────────────────
    //  Enums
    // ─────────────────────────────────────────────────────────────

    enum GenomeStatus { ACTIVE, EXTINCT, DEPLOYED }

    // ─────────────────────────────────────────────────────────────
    //  Data structures
    // ─────────────────────────────────────────────────────────────

    struct Genome {
        uint256      genomeId;
        bytes32      baseModelId;        // hash identifying the foundation model
        bytes32      adapterStorageRoot; // 0G Storage root hash of encrypted LoRA adapter
        uint256[]    parentIds;          // empty for seed genomes
        uint32       generation;         // 0 = seed
        uint8        fitnessScore;       // 0–100, updated by FitnessOracle
        bytes32      lineageRoot;        // Merkle root of ancestry chain
        GenomeStatus status;
        uint256      inferenceRevenue;   // cumulative OG earned from InferencePool
        uint256      mintedAt;           // block number
        bytes32      speciesId;          // writing | code | reasoning | creative
    }

    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    mapping(uint256 => Genome)      public genomes;
    mapping(bytes32 => uint256[])   public speciesPopulation; // speciesId => genomeIds[]

    uint256 public nextId    = 1;
    uint256 public mintFee   = 5 ether;  // 5 OG — updateable by owner

    address public fitnessOracle;
    address public genOps;
    address public treasury;

    uint8 public EXTINCTION_THRESHOLD  = 45;  // below this → EXTINCT
    uint8 public DEPLOYMENT_THRESHOLD  = 88;  // above this → DEPLOYED

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event GenomeMinted(uint256 indexed id, address owner, bytes32 speciesId, uint32 generation);
    event FitnessUpdated(uint256 indexed id, uint8 score, uint256 blockNumber);
    event GenomeExtinct(uint256 indexed id);
    event GenomeDeployed(uint256 indexed id);
    event Crossover(uint256 parentA, uint256 parentB, uint256 childId, uint256 alpha);
    event RevenueAccrued(uint256 indexed id, uint256 amount);
    event ThresholdsUpdated(uint8 extinction, uint8 deployment);
    event MintFeeUpdated(uint256 newFee);

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyOracle() {
        require(
            msg.sender == fitnessOracle || msg.sender == genOps,
            "ModelGenome: unauthorized"
        );
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(
        address _fitnessOracle,
        address _genOps,
        address _treasury
    ) ERC721("SynapseMesh Genome", "GENOME") Ownable(msg.sender) {
        require(_fitnessOracle != address(0), "zero oracle");
        require(_genOps        != address(0), "zero genOps");
        require(_treasury      != address(0), "zero treasury");

        fitnessOracle = _fitnessOracle;
        genOps        = _genOps;
        treasury      = _treasury;
    }

    // ─────────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────────

    function setMintFee(uint256 _fee) external onlyOwner {
        mintFee = _fee;
        emit MintFeeUpdated(_fee);
    }

    function setThresholds(uint8 _extinction, uint8 _deployment) external onlyOwner {
        require(_extinction < _deployment, "ModelGenome: invalid thresholds");
        EXTINCTION_THRESHOLD = _extinction;
        DEPLOYMENT_THRESHOLD = _deployment;
        emit ThresholdsUpdated(_extinction, _deployment);
    }

    function setOracles(address _fitnessOracle, address _genOps) external onlyOwner {
        fitnessOracle = _fitnessOracle;
        genOps        = _genOps;
    }

    // ─────────────────────────────────────────────────────────────
    //  Minting
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Mint a seed genome NFT. Anyone can call this by paying mintFee OG.
     *
     * @param baseModelId        keccak256 of foundation model identifier string
     *                           e.g. keccak256("meta-llama/Llama-3.1-8B")
     * @param adapterStorageRoot Root hash returned by 0G Storage after uploading
     *                           encrypted LoRA adapter weights
     * @param speciesId          keccak256 of species string:
     *                           keccak256("writing") | keccak256("code") |
     *                           keccak256("reasoning") | keccak256("creative")
     */
    function mintSeedGenome(
        bytes32 baseModelId,
        bytes32 adapterStorageRoot,
        bytes32 speciesId
    ) external payable returns (uint256) {
        require(msg.value >= mintFee, "ModelGenome: insufficient mint fee");

        uint256 id = nextId++;

        genomes[id] = Genome({
            genomeId:           id,
            baseModelId:        baseModelId,
            adapterStorageRoot: adapterStorageRoot,
            parentIds:          new uint256[](0),
            generation:         0,
            fitnessScore:       0,
            lineageRoot:        bytes32(0),
            status:             GenomeStatus.ACTIVE,
            inferenceRevenue:   0,
            mintedAt:           block.number,
            speciesId:          speciesId
        });

        speciesPopulation[speciesId].push(id);
        _mint(msg.sender, id);

        // Mint fee to treasury
        payable(treasury).transfer(msg.value);

        emit GenomeMinted(id, msg.sender, speciesId, 0);
        return id;
    }

    /**
     * @notice Mint a child genome from crossover. Called by GenOps only.
     *
     * @param parentA           Token ID of parent A
     * @param parentB           Token ID of parent B
     * @param childAdapterRoot  0G Storage root of the child's merged adapter
     * @param childLineageRoot  Merkle root of child's ancestry tree
     * @param alpha             Crossover mixing ratio * 100 (e.g. 60 = 60% from A)
     */
    function mintChildGenome(
        uint256 parentA,
        uint256 parentB,
        bytes32 childAdapterRoot,
        bytes32 childLineageRoot,
        uint256 alpha
    ) external onlyOracle returns (uint256) {
        require(_ownerOf(parentA) != address(0), "ModelGenome: parentA not exist");
        require(_ownerOf(parentB) != address(0), "ModelGenome: parentB not exist");

        Genome storage pA = genomes[parentA];

        uint256 id = nextId++;
        uint256[] memory parents = new uint256[](2);
        parents[0] = parentA;
        parents[1] = parentB;

        genomes[id] = Genome({
            genomeId:           id,
            baseModelId:        pA.baseModelId,
            adapterStorageRoot: childAdapterRoot,
            parentIds:          parents,
            generation:         pA.generation + 1,
            fitnessScore:       0,
            lineageRoot:        childLineageRoot,
            status:             GenomeStatus.ACTIVE,
            inferenceRevenue:   0,
            mintedAt:           block.number,
            speciesId:          pA.speciesId
        });

        speciesPopulation[pA.speciesId].push(id);
        _mint(ownerOf(parentA), id); // child minted to parent A's owner

        emit Crossover(parentA, parentB, id, alpha);
        emit GenomeMinted(id, ownerOf(parentA), pA.speciesId, pA.generation + 1);
        return id;
    }

    // ─────────────────────────────────────────────────────────────
    //  Fitness — called by FitnessOracle
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Update genome fitness score. Called by FitnessOracle after TEE evaluation.
     * @param genomeId  Token ID
     * @param score     0–100 fitness score from TEE
     */
    function submitFitness(uint256 genomeId, uint8 score) external onlyOracle {
        Genome storage g = genomes[genomeId];
        require(g.status == GenomeStatus.ACTIVE, "ModelGenome: not active");
        require(_ownerOf(genomeId) != address(0), "ModelGenome: genome not exist");

        g.fitnessScore = score;
        emit FitnessUpdated(genomeId, score, block.number);

        if (score < EXTINCTION_THRESHOLD) {
            g.status = GenomeStatus.EXTINCT;
            emit GenomeExtinct(genomeId);
        } else if (score >= DEPLOYMENT_THRESHOLD) {
            g.status = GenomeStatus.DEPLOYED;
            emit GenomeDeployed(genomeId);
        }
    }

    /// @notice Called by InferencePool to record earnings
    function accrueRevenue(uint256 genomeId, uint256 amount) external {
        genomes[genomeId].inferenceRevenue += amount;
        emit RevenueAccrued(genomeId, amount);
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getGenome(uint256 genomeId) external view returns (Genome memory) {
        return genomes[genomeId];
    }

    function getSpeciesPopulation(bytes32 speciesId) external view returns (uint256[] memory) {
        return speciesPopulation[speciesId];
    }

    function getSpeciesCount(bytes32 speciesId) external view returns (uint256) {
        return speciesPopulation[speciesId].length;
    }

    function isActive(uint256 genomeId) external view returns (bool) {
        return genomes[genomeId].status == GenomeStatus.ACTIVE;
    }
}
