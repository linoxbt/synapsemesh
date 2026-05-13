// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;



interface IModelGenome {
function getGenome(uint256 id) external view returns (
uint256 genomeId,
bytes32 baseModelId,
bytes32 adapterStorageRoot,
uint256[] memory parentIds,
uint32  generation,
uint8   fitnessScore,
bytes32 lineageRoot,
uint8   status,
uint256 inferenceRevenue,
uint256 mintedAt,
bytes32 speciesId
);
function ownerOf(uint256 tokenId) external view returns (address);
function accrueRevenue(uint256 genomeId, uint256 amount) external;
}

/**
 * @title InferencePool
 * @notice Deploys high-fitness genomes (score >= DEPLOYMENT_THRESHOLD) to 0G Compute
 *         and distributes earned inference revenue back to genome NFT holders.
 *
 * MAINNET DEPLOYMENT PARAMS:
 *   _genome   : address of ModelGenome
 *   _treasury : TREASURY_ADDRESS (receives platform cut of inference revenue)
 *   _platformShare : basis points for platform (e.g. 1000 = 10%)
 *
 * DEPLOY ORDER: After ModelGenome.
 */
contract InferencePool {

    // ─────────────────────────────────────────────────────────────
    //  Interface
    // ─────────────────────────────────────────────────────────────



    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    address public genome;
    address public treasury;
    address public owner;

    uint256 public platformShare; // basis points out of 10000
    uint256 public holderShare;   // 10000 - platformShare

    mapping(uint256 => bool)    public deployed;           // genomeId => in pool
    mapping(uint256 => uint256) public pendingRewards;     // genomeId => claimable OG
    mapping(uint256 => uint256) public totalEarned;        // genomeId => lifetime earnings

    uint256[] public deployedGenomes;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event GenomeDeployedToPool(uint256 indexed genomeId);
    event GenomeRemovedFromPool(uint256 indexed genomeId);
    event RevenueDistributed(uint256 indexed genomeId, uint256 holderAmount, uint256 platformAmount);
    event RewardClaimed(uint256 indexed genomeId, address holder, uint256 amount);
    event RevenueReceived(uint256 indexed genomeId, uint256 amount);

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "InferencePool: not owner");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(
        address _genome,
        address _treasury,
        uint256 _platformShare
    ) {
        require(_genome   != address(0), "zero genome");
        require(_treasury != address(0), "zero treasury");
        require(_platformShare <= 3000,  "InferencePool: platform share too high (max 30%)");

        genome         = _genome;
        treasury       = _treasury;
        platformShare  = _platformShare;
        holderShare    = 10000 - _platformShare;
        owner          = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    //  Pool management
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Add a deployed genome to the inference pool.
     *         Only DEPLOYED-status genomes (fitness >= 88) can be added.
     *         Called by owner/backend after ModelGenome emits GenomeDeployed.
     */
    function addToPool(uint256 genomeId) external onlyOwner {
        require(!deployed[genomeId], "InferencePool: already in pool");

        // Verify genome is DEPLOYED status (status = 2)
        (, , , , , uint8 fitnessScore, , uint8 status, , , ) =
            IModelGenome(genome).getGenome(genomeId);
        require(status == 2,          "InferencePool: genome not DEPLOYED");
        require(fitnessScore >= 88,   "InferencePool: fitness too low");

        deployed[genomeId] = true;
        deployedGenomes.push(genomeId);

        emit GenomeDeployedToPool(genomeId);
    }

    function removeFromPool(uint256 genomeId) external onlyOwner {
        require(deployed[genomeId], "InferencePool: not in pool");
        deployed[genomeId] = false;
        emit GenomeRemovedFromPool(genomeId);
    }

    // ─────────────────────────────────────────────────────────────
    //  Revenue distribution
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Called by backend when a deployed genome earns inference revenue.
     *         Send OG as msg.value — split between holder and platform treasury.
     *
     * @param genomeId  Token ID that earned the revenue
     */
    function distributeRevenue(uint256 genomeId) external payable {
        require(deployed[genomeId], "InferencePool: genome not in pool");
        require(msg.value > 0,      "InferencePool: zero revenue");

        uint256 platformAmt = (msg.value * platformShare) / 10000;
        uint256 holderAmt   = msg.value - platformAmt;

        pendingRewards[genomeId] += holderAmt;
        totalEarned[genomeId]    += msg.value;

        payable(treasury).transfer(platformAmt);

        // Record on genome NFT
        IModelGenome(genome).accrueRevenue(genomeId, msg.value);

        emit RevenueDistributed(genomeId, holderAmt, platformAmt);
        emit RevenueReceived(genomeId, msg.value);
    }

    /**
     * @notice NFT holder claims accumulated inference rewards.
     * @param genomeId  Token ID to claim rewards for
     */
    function claimReward(uint256 genomeId) external {
        address holder = IModelGenome(genome).ownerOf(genomeId);
        require(msg.sender == holder, "InferencePool: not genome owner");

        uint256 reward = pendingRewards[genomeId];
        require(reward > 0, "InferencePool: nothing to claim");

        pendingRewards[genomeId] = 0;
        payable(holder).transfer(reward);

        emit RewardClaimed(genomeId, holder, reward);
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getPendingReward(uint256 genomeId) external view returns (uint256) {
        return pendingRewards[genomeId];
    }

    function getDeployedGenomes() external view returns (uint256[] memory) {
        return deployedGenomes;
    }

    function isDeployed(uint256 genomeId) external view returns (bool) {
        return deployed[genomeId];
    }

    receive() external payable {}
}
