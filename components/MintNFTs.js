import styles from "../styles/Home.module.css";
import { useMetaplex } from "./useMetaplex";
import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui"

import {
  CandyMachine,
  Metaplex,
  Nft,
  NftWithToken,
  // PublicKey,
  Sft,
  SftWithToken,
  walletAdapterIdentity,
} from "@metaplex-foundation/js"

import { PublicKey } from "@solana/web3.js";
// import { fromTxError } from "@/utils/errors"

import { errorFromCode } from "@metaplex-foundation/mpl-candy-guard"

function fromTxError(err) {
  const match = /custom program error: (\w+)/.exec(err + "")

  if (match === null) {
    return null
  }

  const [codeRaw] = match.slice(1)

  let errorCode
  try {
    errorCode = parseInt(codeRaw, 16)
  } catch (parseErr) {
    return null
  }

  return errorFromCode(errorCode)
}


export const MintNFTs = ({ onClusterChange }) => {
  // const { metaplex } = useMetaplex();
  const wallet = useWallet();
  const { connection } = useConnection()

  const [nft, setNft] = useState(null);

  const [disableMint, setDisableMint] = useState(false);


  const [metaplex, setMetaplex] = useState(null)
  const [candyMachine, setCandyMachine] = useState(null)


  const [collection, setCollection] = useState(null)

  const [isLoading, setIsLoading] = useState(false)
  const [formMessage, setFormMessage] = useState(null)



  const candyMachineAddress = new PublicKey(
    process.env.NEXT_PUBLIC_CANDY_MACHINE_ID
  );
  // let candyMachine;
  let walletBalance;



  useEffect(() => {
    ;(async () => {
      if (wallet && connection && !collection && !candyMachine) {
        if (!process.env.NEXT_PUBLIC_CANDY_MACHINE_ID) {
          throw new Error("Please provide a candy machine id")
        }
        const metaplex = new Metaplex(connection).use(
          walletAdapterIdentity(wallet)
        )
        setMetaplex(metaplex)

        const candyMachine = await metaplex.candyMachines().findByAddress({
          address: new PublicKey(process.env.NEXT_PUBLIC_CANDY_MACHINE_ID),
        })

        setCandyMachine(candyMachine)

        const collection = await metaplex
          .nfts()
          .findByMint({ mintAddress: candyMachine.collectionMintAddress })

        setCollection(collection)

        console.log(collection)
      }
    })()
  }, [wallet, collection, candyMachine])

  const addListener = async () => {
    // add a listener to monitor changes to the candy guard
    metaplex.connection.onAccountChange(candyMachine.candyGuard.address,
      () => checkEligibility()
    );

    // add a listener to monitor changes to the user's wallet
    metaplex.connection.onAccountChange(metaplex.identity().publicKey,
      () => checkEligibility()
    );

    // add a listener to reevaluate if the user is allowed to mint if startDate is reached
    const slot = await metaplex.connection.getSlot();
    const solanaTime = await metaplex.connection.getBlockTime(slot);
    const startDateGuard = candyMachine.candyGuard.guards.startDate;
    if (startDateGuard != null) {
      const candyStartDate = startDateGuard.date.toString(10);
      const refreshTime = candyStartDate - solanaTime.toString(10);
      if (refreshTime > 0) {
        setTimeout(() => checkEligibility(), refreshTime * 1000);
      }
    }

    // also reevaluate eligibility after endDate is reached
    const endDateGuard = candyMachine.candyGuard.guards.endDate;
    if (endDateGuard != null) {
      const candyEndDate = endDateGuard.date.toString(10);
      const refreshTime = solanaTime.toString(10) - candyEndDate;
      if (refreshTime > 0) {
        setTimeout(() => checkEligibility(), refreshTime * 1000);
      }
    }
  };

  const checkEligibility = async () => {
    //wallet not connected?
    if (!wallet.connected) {
      setDisableMint(true);
      return;
    }

    // read candy machine state from chain
    candyMachine = await metaplex
      .candyMachines()
      .findByAddress({ address: candyMachineAddress });

    // enough items available?
    if (
      candyMachine.itemsMinted.toString(10) -
      candyMachine.itemsAvailable.toString(10) >
      0
    ) {
      console.error("not enough items available");
      setDisableMint(true);
      return;
    }

    // guard checks have to be done for the relevant guard group! Example is for the default groups defined in Part 1 of the CM guide
    const guard = candyMachine.candyGuard.guards;

    // Calculate current time based on Solana BlockTime which the on chain program is using - startTime and endTime guards will need that
    const slot = await metaplex.connection.getSlot();
    const solanaTime = await metaplex.connection.getBlockTime(slot);

    if (guard.startDate != null) {
      const candyStartDate = guard.startDate.date.toString(10);
      if (solanaTime < candyStartDate) {
        console.error("startDate: CM not live yet");
        setDisableMint(true);
        return;
      }
    }

    if (guard.endDate != null) {
      const candyEndDate = guard.endDate.date.toString(10);
      if (solanaTime > candyEndDate) {
        console.error("endDate: CM not live anymore");
        setDisableMint(true);
        return;
      }
    }

    if (guard.addressGate != null) {
      if (metaplex.identity().publicKey.toBase58() != guard.addressGate.address.toBase58()) {
        console.error("addressGate: You are not allowed to mint");
        setDisableMint(true);
        return;
      }
    }

    if (guard.mintLimit != null) {
      const mitLimitCounter = metaplex.candyMachines().pdas().mintLimitCounter({
        id: guard.mintLimit.id,
        user: metaplex.identity().publicKey,
        candyMachine: candyMachine.address,
        candyGuard: candyMachine.candyGuard.address,
      });
      //Read Data from chain
      const mintedAmountBuffer = await metaplex.connection.getAccountInfo(mitLimitCounter, "processed");
      let mintedAmount;
      if (mintedAmountBuffer != null) {
        mintedAmount = mintedAmountBuffer.data.readUintLE(0, 1);
      }
      if (mintedAmount != null && mintedAmount >= guard.mintLimit.limit) {
        console.error("mintLimit: mintLimit reached!");
        setDisableMint(true);
        return;
      }
    }

    if (guard.solPayment != null) {
      walletBalance = await metaplex.connection.getBalance(
        metaplex.identity().publicKey
      );

      const costInLamports = guard.solPayment.amount.basisPoints.toString(10);

      if (costInLamports > walletBalance) {
        console.error("solPayment: Not enough SOL!");
        setDisableMint(true);
        return;
      }
    }

    if (guard.freezeSolPayment != null) {
      walletBalance = await metaplex.connection.getBalance(
        metaplex.identity().publicKey
      );

      const costInLamports = guard.freezeSolPayment.amount.basisPoints.toString(10);

      if (costInLamports > walletBalance) {
        console.error("freezeSolPayment: Not enough SOL!");
        setDisableMint(true);
        return;
      }
    }

    if (guard.nftGate != null) {
      const ownedNfts = await metaplex.nfts().findAllByOwner({ owner: metaplex.identity().publicKey });
      const nftsInCollection = ownedNfts.filter(obj => {
        return (obj.collection?.address.toBase58() === guard.nftGate.requiredCollection.toBase58()) && (obj.collection?.verified === true);
      });
      if (nftsInCollection.length < 1) {
        console.error("nftGate: The user has no NFT to pay with!");
        setDisableMint(true);
        return;
      }
    }

    if (guard.nftBurn != null) {
      const ownedNfts = await metaplex.nfts().findAllByOwner({ owner: metaplex.identity().publicKey });
      const nftsInCollection = ownedNfts.filter(obj => {
        return (obj.collection?.address.toBase58() === guard.nftBurn.requiredCollection.toBase58()) && (obj.collection?.verified === true);
      });
      if (nftsInCollection.length < 1) {
        console.error("nftBurn: The user has no NFT to pay with!");
        setDisableMint(true);
        return;
      }
    }

    if (guard.nftPayment != null) {
      const ownedNfts = await metaplex.nfts().findAllByOwner({ owner: metaplex.identity().publicKey });
      const nftsInCollection = ownedNfts.filter(obj => {
        return (obj.collection?.address.toBase58() === guard.nftPayment.requiredCollection.toBase58()) && (obj.collection?.verified === true);
      });
      if (nftsInCollection.length < 1) {
        console.error("nftPayment: The user has no NFT to pay with!");
        setDisableMint(true);
        return;
      }
    }

    if (guard.redeemedAmount != null) {
      if (guard.redeemedAmount.maximum.toString(10) <= candyMachine.itemsMinted.toString(10)) {
        console.error("redeemedAmount: Too many NFTs have already been minted!");
        setDisableMint(true);
        return;
      }
    }

    if (guard.tokenBurn != null) {
      const ata = await metaplex.tokens().pdas().associatedTokenAccount({ mint: guard.tokenBurn.mint, owner: metaplex.identity().publicKey });
      const balance = await metaplex.connection.getTokenAccountBalance(ata);
      if (balance < guard.tokenBurn.amount.basisPoints.toNumber()) {
        console.error("tokenBurn: Not enough SPL tokens to burn!");
        setDisableMint(true);
        return;
      }
    }

    if (guard.tokenGate != null) {
      const ata = await metaplex.tokens().pdas().associatedTokenAccount({ mint: guard.tokenGate.mint, owner: metaplex.identity().publicKey });
      const balance = await metaplex.connection.getTokenAccountBalance(ata);
      if (balance < guard.tokenGate.amount.basisPoints.toNumber()) {
        console.error("tokenGate: Not enough SPL tokens!");
        setDisableMint(true);
        return;
      }
    }

    if (guard.tokenPayment != null) {
      const ata = await metaplex.tokens().pdas().associatedTokenAccount({ mint: guard.tokenPayment.mint, owner: metaplex.identity().publicKey });
      const balance = await metaplex.connection.getTokenAccountBalance(ata);
      if (balance < guard.tokenPayment.amount.basisPoints.toNumber()) {
        console.error("tokenPayment: Not enough SPL tokens to pay!");
        setDisableMint(true);
        return;
      }
      if (guard.freezeTokenPayment != null) {
        const ata = await metaplex.tokens().pdas().associatedTokenAccount({ mint: guard.freezeTokenPayment.mint, owner: metaplex.identity().publicKey });
        const balance = await metaplex.connection.getTokenAccountBalance(ata);
        if (balance < guard.tokenPayment.amount.basisPoints.toNumber()) {
          console.error("freezeTokenPayment: Not enough SPL tokens to pay!");
          setDisableMint(true);
          return;
        }
      }
    }

    //good to go! Allow them to mint
    setDisableMint(false);
  };

  // show and do nothing if no wallet is connected
  if (!wallet.connected) {
    return null;
  }

  // if it's the first time we are processing this function with a connected wallet we read the CM data and add Listeners
  if (candyMachine === undefined) {
    (async () => {
      // read candy machine data to get the candy guards address
      await checkEligibility();
      // Add listeners to refresh CM data to reevaluate if minting is allowed after the candy guard updates or startDate is reached
      addListener();
    }
    )();
  }

  const onClick = async () => {
    try {
    setIsLoading(true)

    // Here the actual mint happens. Depending on the guards that you are using you have to run some pre validation beforehand 
    // Read more: https://docs.metaplex.com/programs/candy-machine/minting#minting-with-pre-validation
    const { nft } = await metaplex.candyMachines().mint({
      candyMachine,
      collectionUpdateAuthority: candyMachine.authorityAddress,
    });

    setIsLoading(false)
    setFormMessage("Minted successfully!")
    setNft(nft);

  } catch (e) {
    const msg = fromTxError(e)

    if (msg) {
      setFormMessage(msg.message)
    } else {
      const msg = e.message || e.toString()
      setFormMessage(msg)
    }
  } finally {
    setIsLoading(false)

    setTimeout(() => {
      setFormMessage(null)
    }, 5000)
  }
  };



  const cost = candyMachine
  ? candyMachine.candyGuard?.guards.solPayment
    ? Number(candyMachine.candyGuard?.guards.solPayment?.amount.basisPoints) /
        1e9 +
      " SOL"
    : "Free mint"
  : "..."


  return (
    <div>
      {/* <select onChange={onClusterChange} className={styles.dropdown}>
      <option value="mainnet">Mainnet</option>
        <option value="devnet">Devnet</option>
        <option value="testnet">Testnet</option>
      </select> */}

      {/* <div>
        <div className={styles.container}>
          <h1 className={styles.title}>NFT Mint Address</h1>
          <div className={styles.nftForm}>
            <input
              type="text"
              value={nft ? nft.mint.address.toBase58() : ""}
              readOnly
            />
            <button onClick={onClick} disabled={disableMint}>
              mint NFT
            </button>
          </div>
          {nft && (
            <div className={styles.nftPreview}>
              <h1>{nft.name}</h1>
              <img
                src={nft?.json?.image || "/fallbackImage.jpg"}
                alt="The downloaded illustration of the provided NFT address."
              />
            </div>
          )}
        </div>
      </div> */}

<main
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "96px 0",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "32px",
            alignItems: "flex-start",
          }}
        >
          <img
            style={{ maxWidth: "396px", borderRadius: "8px" }}
            src={collection?.json?.image}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              background: "#111",
              padding: "32px 24px",
              borderRadius: "16px",
              border: "1px solid #222",
              width: "320px",
            }}
          >
            <h1>{collection?.name}</h1>
            <p style={{ color: "#807a82", marginBottom: "32px" }}>
              {collection?.json?.description}
            </p>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                background: "#261727",
                padding: "16px 12px",
                borderRadius: "16px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>Public</span>
                <b>{cost}</b>
                {/* <b>1 PALM</b>  */}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "16px",
                }}
              >
                <span style={{ fontSize: "11px" }}>Live</span>
                {/* <span style={{ fontSize: "11px" }}>512/1024</span> */}
              </div>
              {/* <button disabled={!publicKey || isLoading} onClick={handleMintV2}>
                {isLoading ? "Minting your NFT..." : "Mint"}
              </button> */}

              <button disabled={disableMint} onClick={onClick}>
                {isLoading ? "Minting your NFT..." : "Mint"}
              </button>
              
              <WalletMultiButton
                style={{
                  width: "100%",
                  height: "auto",
                  marginTop: "8px",
                  padding: "8px 0",
                  justifyContent: "center",
                  fontSize: "13px",
                  backgroundColor: "#111",
                  lineHeight: "1.45",
                }}
              />
              <p
                style={{
                  textAlign: "center",
                  marginTop: "4px",
                }}
              >
                {formMessage}
              </p>
            </div>
          </div>
        </div>

      {nft === null ? (<></>):
      (
        <div>
        <div className={styles.container}>
          <h1 className={styles.title}>NFT Mint Address</h1>
          <div className={styles.nftForm}>
            <input
              type="text"
              value={nft ? nft.mint.address.toBase58() : ""}
              readOnly
            />
            {/* <button onClick={onClick} disabled={disableMint}>
              mint NFT
            </button> */}
          </div>
          {nft && (
            <div className={styles.nftPreview}>
              <h1>{nft.name}</h1>
              <img
                src={nft?.json?.image || "/fallbackImage.jpg"}
                alt="The downloaded illustration of the provided NFT address."
              />
            </div>
          )}
        </div>
      </div>
      )}
         


      </main>
    </div>
  );
};
