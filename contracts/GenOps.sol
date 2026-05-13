// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;



interface IModelGenome {
function mintChildGenome(
uint256 parentA,
uint256 parentB,
bytes32 childAdapterRoot,
bytes32 childLineageRoot,
uint256 alpha
) external returns (uint256);

function getGenome(uint256 id) external view returns (
uint256, bytes32, bytes32, uint256[] memory,
uint32, uint8, bytes32, uint8, uint256, uint256, bytes32
);

function isActive(uint256 id) external view returns (bool);
}

/**
 * @title GenOps
 * @notice Genetic operators for the Evolution Lab.
 *         Handles selection, crossover and mutation triggers.
 *         The actual adapter weight arithmetic happens off-chain in the backend;
 *         this contract records the operation on-chain and mints child genomes.
 *
 * MAINNET DEPLOYMENT PARAMS:
 *   _genome      : address(0) initially — set via setGenome() after ModelGenome deploys
 *   _evoClock    : address of EvolutionClock
 *   _treasury    : TREASURY_ADDRESS (receives breeding fees)
 *   _breedingFee : OG wei fee per crossover (e.g. 1 ether = 1 OG)
 *
 * DEPLOY ORDER: Deploy before ModelGenome (with address(0) for genome param).
 *               After ModelGenome deploys, call setGenome(modelGenomeAddress).
 */
contract GenOps {

    // ─────────────────────────────────────────────────────────────
    //  Interfaces
    // ─────────────────────────────────────────────────────────────



    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    address public genome;
    address public evoClock;
    address public treasury;
    address public owner;

    uint256 public breedingFee;    // OG wei per crossover
    uint256 public mutationRate;   // out of 10000 — e.g. 500 = 5%

    mapping(uint256 => uint256) public lastMutatedAt;    // genomeId => block
    mapping(uint256 => uint256) public crossoverCount;   // genomeId => times bred

    uint256 public MAX_BREED_COUNT = 5; // max times a genome can be a parent

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event CrossoverTriggered(
        uint256 parentA,
        uint256 parentB,
        uint256 childId,
        uint256 alpha,
        bytes32 childAdapterRoot
    );
    event MutationTriggered(uint256 indexed genomeId, bytes32 newAdapterRoot);
    event SelectionRun(uint256 generation, uint256 selectedCount);
    event GenomeSet(address genome);
    event BreedingFeeUpdated(uint256 newFee);
    event MutationRateUpdated(uint256 newRate);

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "GenOps: not owner");
        _;
    }

    modifier onlyClock() {
        require(msg.sender == evoClock, "GenOps: only EvolutionClock");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(
        address _evoClock,
        address _treasury,
        uint256 _breedingFee,
        uint256 _mutationRate
    ) {
        require(_treasury != address(0), "zero treasury");
        evoClock     = _evoClock;
        treasury     = _treasury;
        breedingFee  = _breedingFee;
        mutationRate = _mutationRate;
        owner        = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────────

    function setGenome(address _genome) external onlyOwner {
        require(_genome != address(0), "zero genome");
        genome = _genome;
        emit GenomeSet(_genome);
    }

    function setBreedingFee(uint256 _fee) external onlyOwner {
        breedingFee = _fee;
        emit BreedingFeeUpdated(_fee);
    }

    function setMutationRate(uint256 _rate) external onlyOwner {
        require(_rate <= 10000, "GenOps: rate > 100%");
        mutationRate = _rate;
        emit MutationRateUpdated(_rate);
    }

    function setMaxBreedCount(uint256 _max) external onlyOwner {
        MAX_BREED_COUNT = _max;
    }

    // ─────────────────────────────────────────────────────────────
    //  Genetic operators
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Trigger arithmetic crossover of two parent genomes.
     *         Backend computes childAdapterRoot off-chain (arithmetic interpolation
     *         of adapter weights: child = alpha*parentA + (1-alpha)*parentB),
     *         uploads to 0G Storage, then calls this function with the root hash.
     *
     * @param parentA           Token ID of parent A (higher fitness)
     * @param parentB           Token ID of parent B
     * @param childAdapterRoot  0G Storage root of merged adapter
     * @param childLineageRoot  Merkle root of child's ancestry
     * @param alpha             Mixing ratio * 100 (0–100, e.g. 60 = 60% from A)
     */
    function crossover(
        uint256 parentA,
        uint256 parentB,
        bytes32 childAdapterRoot,
        bytes32 childLineageRoot,
        uint256 alpha
    ) external payable returns (uint256 childId) {
        require(genome != address(0),              "GenOps: genome not set");
        require(msg.value >= breedingFee,          "GenOps: insufficient breeding fee");
        require(alpha <= 100,                      "GenOps: alpha out of range");
        require(parentA != parentB,                "GenOps: same parent");
        require(IModelGenome(genome).isActive(parentA), "GenOps: parentA not active");
        require(IModelGenome(genome).isActive(parentB), "GenOps: parentB not active");
        require(crossoverCount[parentA] < MAX_BREED_COUNT, "GenOps: parentA over breed limit");
        require(crossoverCount[parentB] < MAX_BREED_COUNT, "GenOps: parentB over breed limit");

        crossoverCount[parentA]++;
        crossoverCount[parentB]++;

        // Breeding fee to treasury
        payable(treasury).transfer(msg.value);

        childId = IModelGenome(genome).mintChildGenome(
            parentA, parentB, childAdapterRoot, childLineageRoot, alpha
        );

        emit CrossoverTriggered(parentA, parentB, childId, alpha, childAdapterRoot);
    }

    /**
     * @notice Apply Gaussian mutation to a genome's adapter.
     *         Backend mutates adapter weights off-chain, uploads new adapter
     *         to 0G Storage, and calls this with the new root hash.
     *
     * @param genomeId       Token ID to mutate
     * @param newAdapterRoot New 0G Storage root after mutation
     */
    function mutate(
        uint256 genomeId,
        bytes32 newAdapterRoot
    ) external onlyOwner {
        require(genome != address(0), "GenOps: genome not set");
        require(IModelGenome(genome).isActive(genomeId), "GenOps: genome not active");

        lastMutatedAt[genomeId] = block.number;
        emit MutationTriggered(genomeId, newAdapterRoot);

        // Note: adapter root update on ModelGenome requires an updateAdapterRoot()
        // function — add to ModelGenome if mutation is needed post-mint.
    }

    /**
     * @notice Called by EvolutionClock each epoch. Backend listens to this event
     *         and runs selection + crossover + mutation off-chain.
     * @param generation Current generation number from EvolutionClock
     */
    function runEpoch(uint256 generation) external onlyClock {
        emit SelectionRun(generation, 0); // backend fills actual selectedCount in response
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getBreedCount(uint256 genomeId) external view returns (uint256) {
        return crossoverCount[genomeId];
    }

    function canBreed(uint256 genomeId) external view returns (bool) {
        return crossoverCount[genomeId] < MAX_BREED_COUNT
            && IModelGenome(genome).isActive(genomeId);
    }
}
