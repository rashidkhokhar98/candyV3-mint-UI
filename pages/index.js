import Head from "next/head"
import styles from "../styles/Home.module.css";
import { useMemo, useState, useEffect } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import {
  GlowWalletAdapter,
  PhantomWalletAdapter,
  SlopeWalletAdapter,
  SolflareWalletAdapter,
  TorusWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import {
  WalletModalProvider,
  WalletMultiButton,
} from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";
import { MetaplexProvider } from "../components/MetaplexProvider.js";
import { MintNFTs } from "../components/MintNFTs.js";
import "@solana/wallet-adapter-react-ui/styles.css";
import dynamic from 'next/dynamic';

export default function Home() {
  // const [network, setNetwork] = useState(WalletAdapterNetwork.Mainnet);

  // console.log("network", network)

  // const endpoint = useMemo(() => clusterApiUrl(network), [network]);

  // const wallets = useMemo(
  //   () => [
  //     new PhantomWalletAdapter(),
  //     // new GlowWalletAdapter(),
  //     // new SlopeWalletAdapter(),
  //     new SolflareWalletAdapter({ network }),
  //     new TorusWalletAdapter(),
  //   ],
  //   [network]
  // );

  // const handleChange = (event) => {
  //   switch (event.target.value) {
  //     case "devnet":
  //       setNetwork(WalletAdapterNetwork.Devnet);
  //       break;
  //     case "mainnet":
  //       setNetwork(WalletAdapterNetwork.Mainnet);
  //       break;
  //     case "testnet":
  //       setNetwork(WalletAdapterNetwork.Testnet);
  //       break;
  //     default:
  //       setNetwork(WalletAdapterNetwork.Mainnet);
  //       break;
  //   }
  // };


  const handleChange = (event) => {
    console.log("we are using mainnet")
  };



  if (!process.env.NEXT_PUBLIC_RPC_ENDPOINT) throw new Error("Missing RPC URL")

  const endpoint = process.env.NEXT_PUBLIC_RPC_ENDPOINT

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      // new BackpackWalletAdapter(),
      new SolflareWalletAdapter(),
      new TorusWalletAdapter(),
      // new LedgerWalletAdapter(),
    ],
    []
  )

  const ButtonWrapper = dynamic(() =>
    import('@solana/wallet-adapter-react-ui').then((mod) => mod.WalletMultiButton)
  );


  return (
    <>
     <Head>
        <title>4 B share Collection Mint</title>
        <meta name="description" content="Get your unique NFT now!" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
    <div>
     
      <ConnectionProvider endpoint={endpoint}  config={{ commitment: "confirmed" }}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <MetaplexProvider>
              <div className={styles.App}>
                <ButtonWrapper />
                <MintNFTs onClusterChange={handleChange} />
              </div>
            </MetaplexProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </div>
    </>

  );
}
