// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;



interface IMeshEscrow {
function release(bytes32 taskId, address agent) external;
}

interface IAgentRegistry {
function incrementReputation(address agent, uint8 score) external;
function slash(address agent) external;
}

interface IDAGRegistry {
function markNodeComplete(bytes32 taskId) external;
}

/**
 * @title TEEVerifierBridge
 * @notice Receives quality scores signed by the 0G Compute TEE node.
 *         Verifies the ECDSA signature against TEE_SIGNER_ADDRESS,
 *         then either releases escrow + boosts reputation (pass)
 *         or slashes the agent (fail).
 *
 * MAINNET DEPLOYMENT PARAMS:
 *   _escrow      : address of MeshEscrow
 *   _agentReg    : address of AgentRegistry
 *   _dagReg      : address of TaskDAGRegistry
 *   _signer      : TEE_SIGNER_ADDRESS from .env
 *                  (public address of the TEE's signing key)
 *   _mrEnclave   : TEE_MR_ENCLAVE from .env
 *                  (bytes32 image identity of the TEE program)
 *
 * DEPLOY ORDER: Last in Task Economy group.
 * After deploying, call:
 *   AgentRegistry.setTeeVerifier(thisAddress)
 *   MeshEscrow.setTeeVerifier(thisAddress)
 *   TaskDAGRegistry.setTeeVerifier(thisAddress)
 */
contract TEEVerifierBridge {

    // ─────────────────────────────────────────────────────────────
    //  Interfaces
    // ─────────────────────────────────────────────────────────────







    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    IMeshEscrow    public escrow;
    IAgentRegistry public agentReg;
    IDAGRegistry   public dagReg;

    address public trustedVerifierSigner; // TEE_SIGNER_ADDRESS
    bytes32 public trustedMrEnclave;      // TEE_MR_ENCLAVE
    address public owner;

    uint8 public MIN_QUALITY = 70; // minimum score to pass (0–100)

    mapping(bytes32 => bool) public processed; // taskId => already verified

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event VerificationSubmitted(
        bytes32 indexed taskId,
        address indexed agent,
        bool    passed,
        uint8   score
    );
    event SignerUpdated(address newSigner);
    event EnclaveUpdated(bytes32 newMrEnclave);
    event MinQualityUpdated(uint8 newMin);

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "TEEVerifier: not owner");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(
        address _escrow,
        address _agentReg,
        address _dagReg,
        address _signer,
        bytes32 _mrEnclave
    ) {
        require(_escrow   != address(0), "zero escrow");
        require(_agentReg != address(0), "zero agentReg");
        require(_dagReg   != address(0), "zero dagReg");
        require(_signer   != address(0), "zero signer");

        escrow                 = IMeshEscrow(_escrow);
        agentReg               = IAgentRegistry(_agentReg);
        dagReg                 = IDAGRegistry(_dagReg);
        trustedVerifierSigner  = _signer;
        trustedMrEnclave       = _mrEnclave;
        owner                  = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────────

    function updateSigner(address _newSigner) external onlyOwner {
        require(_newSigner != address(0), "zero signer");
        trustedVerifierSigner = _newSigner;
        emit SignerUpdated(_newSigner);
    }

    function updateMrEnclave(bytes32 _newEnclave) external onlyOwner {
        trustedMrEnclave = _newEnclave;
        emit EnclaveUpdated(_newEnclave);
    }

    function setMinQuality(uint8 _min) external onlyOwner {
        MIN_QUALITY = _min;
        emit MinQualityUpdated(_min);
    }

    // ─────────────────────────────────────────────────────────────
    //  Verification — called by backend after polling TEE result
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Submit a TEE-signed verification result.
     *
     * @param taskId        bytes32 task identifier
     * @param assignedAgent address of the agent who did the work
     * @param passed        true if score >= MIN_QUALITY
     * @param score         quality score 0–100 from TEE
     * @param teeSignature  ECDSA signature from the TEE node
     *                      — must be signed by TEE_SIGNER_ADDRESS
     *                      — message: keccak256(taskId, passed, score, mrEnclave)
     */
    function submitVerification(
        bytes32        taskId,
        address        assignedAgent,
        bool           passed,
        uint8          score,
        bytes calldata teeSignature
    ) external {
        require(!processed[taskId],           "TEEVerifier: already processed");
        require(assignedAgent != address(0),  "TEEVerifier: zero agent");

        // Reconstruct signed message including mrEnclave for enclave binding
        bytes32 msgHash = keccak256(
            abi.encodePacked(taskId, passed, score, trustedMrEnclave)
        );
        bytes32 ethHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash)
        );

        address recovered = _recover(ethHash, teeSignature);
        require(
            recovered == trustedVerifierSigner,
            "TEEVerifier: invalid TEE attestation"
        );

        processed[taskId] = true;

        emit VerificationSubmitted(taskId, assignedAgent, passed, score);

        if (passed && score >= MIN_QUALITY) {
            escrow.release(taskId, assignedAgent);
            agentReg.incrementReputation(assignedAgent, score);
            dagReg.markNodeComplete(taskId);
        } else {
            agentReg.slash(assignedAgent);
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  Internal — ECDSA recovery
    // ─────────────────────────────────────────────────────────────

    function _recover(bytes32 h, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "TEEVerifier: bad sig length");
        bytes32 r;
        bytes32 s;
        uint8   v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "TEEVerifier: bad v");
        return ecrecover(h, v, r, s);
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function isProcessed(bytes32 taskId) external view returns (bool) {
        return processed[taskId];
    }
}
