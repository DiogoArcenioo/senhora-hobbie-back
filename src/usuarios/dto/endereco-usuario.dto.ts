export class EnderecoUsuarioDto {
  logradouro!: string;
  numero!: string;
  complemento?: string | null;
  bairro!: string;
  cidade!: string;
  estado!: string;
  cep!: string;
}
