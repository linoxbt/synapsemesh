// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;



interface IERC721 {
function transferFrom(address from, address to, uint256 tokenId) external;
function ownerOf(uint256 tokenId) external view returns (address);
function getApproved(uint256 tokenId) external view returns (address);
function isApprovedForAll(address owner, address operator) external view returns (bool);
}

/**
 * @title GenomeMarket
 * @notice Buy, sell, and rent genome NFTs. Sellers list at a fixed price.
 *         Platform takes a cut of every sale. Rental grants temporary usage rights.
 *
 * MAINNET DEPLOYMENT PARAMS:
 *   _genome        : address of ModelGenome
 *   _treasury      : TREASURY_ADDRESS
 *   _platformFeeBps: basis points platform fee (e.g. 250 = 2.5%)
 *
 * DEPLOY ORDER: After ModelGenome.
 */
contract GenomeMarket {

    // ─────────────────────────────────────────────────────────────
    //  Interfaces
    // ─────────────────────────────────────────────────────────────



    // ─────────────────────────────────────────────────────────────
    //  Data structures
    // ─────────────────────────────────────────────────────────────

    struct Listing {
        address seller;
        uint256 price;      // OG wei
        bool    active;
    }

    struct Rental {
        address renter;
        uint256 expiresAt;  // block number
        uint256 pricePerBlock; // OG wei per block
    }

    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    mapping(uint256 => Listing) public listings;  // genomeId => Listing
    mapping(uint256 => Rental)  public rentals;   // genomeId => Rental
    mapping(uint256 => uint256) public rentalPrices; // genomeId => OG wei per block

    address public genome;
    address public treasury;
    address public owner;

    uint256 public platformFeeBps; // e.g. 250 = 2.5%

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event Listed(uint256 indexed genomeId, address seller, uint256 price);
    event Delisted(uint256 indexed genomeId, address seller);
    event Sold(uint256 indexed genomeId, address seller, address buyer, uint256 price);
    event Rented(uint256 indexed genomeId, address renter, uint256 expiresAt, uint256 totalPaid);
    event RentalExpired(uint256 indexed genomeId);
    event RentalPriceSet(uint256 indexed genomeId, uint256 pricePerBlock);
    event FeeUpdated(uint256 newFeeBps);

    // ─────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "GenomeMarket: not owner");
        _;
    }

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(
        address _genome,
        address _treasury,
        uint256 _platformFeeBps
    ) {
        require(_genome   != address(0), "zero genome");
        require(_treasury != address(0), "zero treasury");
        require(_platformFeeBps <= 1000, "GenomeMarket: fee too high (max 10%)");

        genome         = _genome;
        treasury       = _treasury;
        platformFeeBps = _platformFeeBps;
        owner          = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────
    //  Admin
    // ─────────────────────────────────────────────────────────────

    function setPlatformFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, "GenomeMarket: max 10%");
        platformFeeBps = _feeBps;
        emit FeeUpdated(_feeBps);
    }

    // ─────────────────────────────────────────────────────────────
    //  Listing
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice List a genome NFT for sale. Caller must approve this contract first.
     *         Call ModelGenome.approve(marketAddress, genomeId) before listing.
     *
     * @param genomeId  Token ID to list
     * @param price     Sale price in OG wei
     */
    function list(uint256 genomeId, uint256 price) external {
        IERC721 nft = IERC721(genome);
        require(nft.ownerOf(genomeId) == msg.sender, "GenomeMarket: not owner");
        require(
            nft.getApproved(genomeId) == address(this) ||
            nft.isApprovedForAll(msg.sender, address(this)),
            "GenomeMarket: not approved"
        );
        require(price > 0, "GenomeMarket: zero price");
        require(!listings[genomeId].active, "GenomeMarket: already listed");
        require(!_isRented(genomeId), "GenomeMarket: rented");

        nft.transferFrom(msg.sender, address(this), genomeId);

        listings[genomeId] = Listing({
            seller: msg.sender,
            price:  price,
            active: true
        });

        emit Listed(genomeId, msg.sender, price);
    }

    function delist(uint256 genomeId) external {
        Listing storage l = listings[genomeId];
        require(l.active,             "GenomeMarket: not listed");
        require(l.seller == msg.sender || msg.sender == owner, "GenomeMarket: unauthorized");
        address seller = l.seller;
        l.active = false;
        IERC721(genome).transferFrom(address(this), seller, genomeId);
        emit Delisted(genomeId, seller);
    }

    function setRentalPrice(uint256 genomeId, uint256 pricePerBlock) external {
        IERC721 nft = IERC721(genome);
        require(nft.ownerOf(genomeId) == msg.sender, "GenomeMarket: not owner");
        require(!listings[genomeId].active, "GenomeMarket: listed for sale");
        rentalPrices[genomeId] = pricePerBlock;
        emit RentalPriceSet(genomeId, pricePerBlock);
    }

    /**
     * @notice Buy a listed genome NFT. Send exact price as msg.value.
     */
    function buy(uint256 genomeId) external payable {
        Listing storage l = listings[genomeId];
        require(l.active,           "GenomeMarket: not listed");
        require(msg.value >= l.price, "GenomeMarket: insufficient payment");
        require(!_isRented(genomeId), "GenomeMarket: rented");

        address seller = l.seller;
        uint256 price  = l.price;

        l.active = false;

        uint256 fee       = (price * platformFeeBps) / 10000;
        uint256 sellerAmt = price - fee;

        // Listed NFTs are held in escrow by this contract.
        IERC721(genome).transferFrom(address(this), msg.sender, genomeId);

        // Pay seller and treasury
        _sendValue(seller, sellerAmt);
        _sendValue(treasury, fee);

        // Refund excess
        if (msg.value > price) {
            _sendValue(msg.sender, msg.value - price);
        }

        emit Sold(genomeId, seller, msg.sender, price);
    }

    // ─────────────────────────────────────────────────────────────
    //  Rental
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Rent a genome for a number of blocks. The genome NFT stays with
     *         the owner — rental records usage rights only.
     *
     * @param genomeId       Token ID to rent
     * @param blocks         Number of blocks to rent for
     */
    function rent(
        uint256 genomeId,
        uint256 blocks
    ) external payable {
        require(blocks > 0,           "GenomeMarket: zero blocks");
        uint256 pricePerBlock = rentalPrices[genomeId];
        require(pricePerBlock > 0,    "GenomeMarket: zero price");
        require(!listings[genomeId].active, "GenomeMarket: listed for sale");

        uint256 totalCost = blocks * pricePerBlock;
        require(msg.value >= totalCost, "GenomeMarket: insufficient payment");

        // Ensure no active rental
        Rental memory existing = rentals[genomeId];
        require(
            existing.renter == address(0) || block.number > existing.expiresAt,
            "GenomeMarket: already rented"
        );

        address nftOwner = IERC721(genome).ownerOf(genomeId);
        require(nftOwner != address(0), "GenomeMarket: genome not exist");

        uint256 fee      = (totalCost * platformFeeBps) / 10000;
        uint256 ownerAmt = totalCost - fee;

        rentals[genomeId] = Rental({
            renter:       msg.sender,
            expiresAt:    block.number + blocks,
            pricePerBlock: pricePerBlock
        });

        _sendValue(nftOwner, ownerAmt);
        _sendValue(treasury, fee);

        if (msg.value > totalCost) {
            _sendValue(msg.sender, msg.value - totalCost);
        }

        emit Rented(genomeId, msg.sender, block.number + blocks, totalCost);
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getListing(uint256 genomeId) external view returns (Listing memory) {
        return listings[genomeId];
    }

    function getRental(uint256 genomeId) external view returns (Rental memory) {
        return rentals[genomeId];
    }

    function isRented(uint256 genomeId) external view returns (bool) {
        return _isRented(genomeId);
    }

    function _isRented(uint256 genomeId) internal view returns (bool) {
        Rental memory r = rentals[genomeId];
        return r.renter != address(0) && block.number <= r.expiresAt;
    }

    function currentRenter(uint256 genomeId) external view returns (address) {
        Rental memory r = rentals[genomeId];
        if (block.number <= r.expiresAt) return r.renter;
        return address(0);
    }

    function _sendValue(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "GenomeMarket: transfer failed");
    }
}
