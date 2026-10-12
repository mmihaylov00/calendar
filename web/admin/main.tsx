import { render } from 'preact';
import { App } from './App';
import '@fontsource-variable/inter';
import '../shared/emoji-font.css';
import './styles.css';
import './styles2.css';
import './calendar.css';

render(<App />, document.getElementById('app')!);
