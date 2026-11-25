import React from 'react';
import {createRoot} from 'react-dom/client';
import {WalletPanel} from './WalletPanel.jsx';
const provider=window.ethereum?.providers?.length>1?undefined:window.ethereum;
createRoot(document.getElementById('root')).render(<WalletPanel provider={provider}/>);
