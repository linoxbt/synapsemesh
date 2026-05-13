// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;



interface IModelGenome {
function submitFitness(uint256 genomeId, uint8 score) external;
function isActive(uint256 genomeId) external view returns (bool);
}

/**
 * @title FitnessOracle
 * @notice Receives TEE-signed fitness scores for genome NFTs.
 *         Anyone can request evaluation; backend listens to EvaluationRequested,
 *         runs inference on 0G Compute TEE, and submits the signed result back.
 *
 * MAINNET DEPLOYMENT PARAMS:
 *   _genome  : address(0) initially — set via setGenome() after ModelGenome deploys
 *   _signer  : TEE_SIGNER_ADDRESS from .env
 *   _mrEnclave : TEE_MR_ENCLAVE from .env
 *
 * DEPLOY ORDER: Before ModelGenome.
 *               After ModelGenome deploys, call setGenome(modelGenomeAddress).
 */
contract FitnessOracle {

    // ─────────────────────────────────────────────────────────────
    //  Interface
    // ─────────────────────────────────────────────────────────────



    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    address public genome;
    address public trustedSigner;   // TEE_SIGNER_ADDRESS
    bytes32 public trustedEnclave;  // TEE_MR_ENCLAVE
    address public owner;

    mapping(uint256 => uint256) public lastEvalBlock;    // genomeId => last eval block
    mapping(uint256 => uint8)   public lastFitnessScore; // genomeId => last score

    uint256 public MIN_EVAL_INTERVAL = 100; // blocks between evaluations

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event EvaluationRequested(uint256 indexed genomeId, uint256 blockNumber);
    event FitnessSubmitted(uint256 indexed genomeId, uint8 score, bytes32 benchmarkHash);
    event GenomeSet(address genome);
    event SignerUpdated(address newSigner);
    event EnclaveUpdated(bytes32 newEnclave);
    event EvalIntervalUpdated(uint256 newInterval);

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "FitnessOracle: not owner");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(
        address _signer,
        bytes32 _mrEnclave
    ) {
        require(_signer != address(0), "zero signer");
        trustedSigner  = _signer;
        trustedEnclave = _mrEnclave;
        owner          = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────────

    function setGenome(address _genome) external onlyOwner {
        require(_genome != address(0), "zero genome");
        genome = _genome;
        emit GenomeSet(_genome);
    }

    function updateSigner(address _signer) external onlyOwner {
        require(_signer != address(0), "zero signer");
        trustedSigner = _signer;
        emit SignerUpdated(_signer);
    }

    function updateEnclave(bytes32 _enclave) external onlyOwner {
        trustedEnclave = _enclave;
        emit EnclaveUpdated(_enclave);
    }

    function setMinEvalInterval(uint256 _interval) external onlyOwner {
        MIN_EVAL_INTERVAL = _interval;
        emit EvalIntervalUpdated(_interval);
    }

    // ─────────────────────────────────────────────────────────────
    //  Evaluation flow
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Request a fitness evaluation for a genome.
     *         Anyone can call this. Backend listens to EvaluationRequested,
     *         runs benchmarks on 0G Compute TEE, then calls submitFitness().
     *
     * @param genomeId  Token ID of the genome to evaluate
     */
    function requestEvaluation(uint256 genomeId) external {
        require(genome != address(0),               "FitnessOracle: genome not set");
        require(IModelGenome(genome).isActive(genomeId), "FitnessOracle: genome not active");
        require(
            block.number >= lastEvalBlock[genomeId] + MIN_EVAL_INTERVAL,
            "FitnessOracle: too soon since last eval"
        );

        lastEvalBlock[genomeId] = block.number;
        emit EvaluationRequested(genomeId, block.number);
    }

    /**
     * @notice Submit a TEE-signed fitness score.
     *         Called by the backend after receiving TEE result from 0G Compute.
     *
     * @param genomeId      Token ID
     * @param score         0–100 fitness score
     * @param benchmarkHash keccak256 of benchmark prompts used in evaluation
     * @param teeSignature  ECDSA sig from TEE node
     *                      Message: keccak256(genomeId, score, benchmarkHash, mrEnclave)
     */
    function submitFitness(
        uint256        genomeId,
        uint8          score,
        bytes32        benchmarkHash,
        bytes calldata teeSignature
    ) external {
        require(genome != address(0), "FitnessOracle: genome not set");

        // Verify TEE signature includes mrEnclave for enclave binding
        bytes32 msgHash = keccak256(
            abi.encodePacked(genomeId, score, benchmarkHash, trustedEnclave)
        );
        bytes32 ethHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash)
        );

        address recovered = _recover(ethHash, teeSignature);
        require(recovered == trustedSigner, "FitnessOracle: invalid TEE signature");

        lastFitnessScore[genomeId] = score;

        IModelGenome(genome).submitFitness(genomeId, score);
        emit FitnessSubmitted(genomeId, score, benchmarkHash);
    }

    // ─────────────────────────────────────────────────────────────
    //  Internal — ECDSA recovery
    // ─────────────────────────────────────────────────────────────

    function _recover(bytes32 h, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "FitnessOracle: bad sig length");
        bytes32 r;
        bytes32 s;
        uint8   v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "FitnessOracle: bad v");
        return ecrecover(h, v, r, s);
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getLastScore(uint256 genomeId) external view returns (uint8) {
        return lastFitnessScore[genomeId];
    }

    function blocksUntilNextEval(uint256 genomeId) external view returns (uint256) {
        uint256 next = lastEvalBlock[genomeId] + MIN_EVAL_INTERVAL;
        return block.number >= next ? 0 : next - block.number;
    }
}
