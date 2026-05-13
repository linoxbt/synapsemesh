// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;



interface IGenOps {
function runEpoch(uint256 generation) external;
}

/**
 * @title EvolutionClock
 * @notice Epoch timer for the Evolution Lab. Anyone can call triggerEpoch()
 *         once epochLength blocks have passed. Calls GenOps.runEpoch() which
 *         backend listens to for running selection + crossover + mutation.
 *
 * MAINNET DEPLOYMENT PARAMS:
 *   _genOps      : address of GenOps
 *   _epochLength : number of blocks per generation (e.g. 100 blocks ≈ 100 seconds on 0G)
 *
 * DEPLOY ORDER: After GenOps.
 */
contract EvolutionClock {

    // ─────────────────────────────────────────────────────────────
    //  Interface
    // ─────────────────────────────────────────────────────────────



    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    address public genOps;
    address public owner;

    uint256 public epochLength;       // blocks per generation
    uint256 public lastEpochBlock;    // block when last epoch was triggered
    uint256 public currentGeneration; // increments each epoch

    bool public paused;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event EpochTriggered(uint256 indexed generation, uint256 blockNumber, address triggeredBy);
    event EpochLengthUpdated(uint256 newLength);
    event Paused(bool isPaused);
    event GenOpsUpdated(address newGenOps);

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "EvolutionClock: not owner");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(address _genOps, uint256 _epochLength) {
        require(_genOps != address(0), "zero genOps");
        require(_epochLength > 0,      "zero epochLength");
        genOps        = _genOps;
        epochLength   = _epochLength;
        lastEpochBlock = block.number;
        owner         = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────────

    function setEpochLength(uint256 _newLength) external onlyOwner {
        require(_newLength > 0, "zero length");
        epochLength = _newLength;
        emit EpochLengthUpdated(_newLength);
    }

    function setGenOps(address _genOps) external onlyOwner {
        require(_genOps != address(0), "zero genOps");
        genOps = _genOps;
        emit GenOpsUpdated(_genOps);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit Paused(_paused);
    }

    // ─────────────────────────────────────────────────────────────
    //  Epoch trigger — callable by anyone
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Trigger the next evolution epoch.
     *         Anyone can call this once epochLength blocks have passed.
     *         The call forwards to GenOps.runEpoch() which emits an event
     *         the backend listens to for running genetic operations off-chain.
     */
    function triggerEpoch() external {
        require(!paused, "EvolutionClock: paused");
        require(
            block.number >= lastEpochBlock + epochLength,
            "EvolutionClock: epoch not over yet"
        );

        lastEpochBlock = block.number;
        currentGeneration++;

        emit EpochTriggered(currentGeneration, block.number, msg.sender);

        // Notify GenOps — backend listens to SelectionRun event from GenOps
        IGenOps(genOps).runEpoch(currentGeneration);
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function blocksUntilNextEpoch() external view returns (uint256) {
        uint256 next = lastEpochBlock + epochLength;
        return block.number >= next ? 0 : next - block.number;
    }

    function isEpochReady() external view returns (bool) {
        return !paused && block.number >= lastEpochBlock + epochLength;
    }

    function getGeneration() external view returns (uint256) {
        return currentGeneration;
    }
}
