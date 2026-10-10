import { render, screen } from '@testing-library/react';
import EtusHubLink from '../EtusHubLink';

describe('EtusHubLink', () => {
  it('opens the hub app launcher in a new tab', () => {
    render(<EtusHubLink hubUrl="https://apps.etus.io" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://apps.etus.io/apps');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
